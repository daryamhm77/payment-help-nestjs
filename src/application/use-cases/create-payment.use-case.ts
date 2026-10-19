import {
  IdempotencyKeyConflictError,
  PaymentNotFoundError,
} from '../../domain/errors/payment-persistence-errors';
import { ProviderUnknownOutcomeError } from '../../domain/errors/payment-provider-errors';
import { PaymentStatus } from '../../domain/payment-status';
import { Payment } from '../../domain/payment.entity';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key.vo';
import { MerchantScope } from '../../domain/value-objects/merchant-scope.vo';
import { Money } from '../../domain/value-objects/money.vo';
import { PaymentId } from '../../domain/value-objects/payment-id.vo';
import { CreatePaymentCommand, PaymentOperationResult } from '../dto/orchestration.dto';
import { IdempotencyStorePort } from '../ports/idempotency-store.port';
import { PaymentRepositoryPort } from '../ports/payment-repository.port';
import { PaymentProviderRegistry } from '../services/payment-provider-registry';
import { fingerprintPayload } from '../services/request-fingerprint';

import { reconcileWithProvider } from './reconcile-payment';

export interface CreatePaymentUseCaseDeps {
  readonly payments: PaymentRepositoryPort;
  readonly idempotency: IdempotencyStorePort;
  readonly providers: PaymentProviderRegistry;
}

/**
 * Creates a payment safely:
 * 1. Reserve durable idempotency row (unique per scope+key).
 * 2. Persist local Payment (CREATED) — never inside the same TX as provider I/O.
 * 3. Call provider outside any DB transaction.
 * 4. On timeout / unknown: mark UNKNOWN and return; retries reconcile instead of
 *    creating a second provider payment.
 */
export class CreatePaymentUseCase {
  public constructor(private readonly deps: CreatePaymentUseCaseDeps) {}

  public async execute(command: CreatePaymentCommand): Promise<PaymentOperationResult> {
    const scope = MerchantScope.fromString(command.merchantScope);
    const idempotencyKey = IdempotencyKey.fromString(command.idempotencyKey);
    const amount = Money.fromMinorUnits(command.amountInMinorUnits, command.currency);
    const provider = this.deps.providers.resolve(command.providerName);

    const fingerprint = fingerprintPayload({
      scope: scope.toString(),
      amount: amount.getAmountInMinorUnits().toString(),
      currency: amount.getCurrency(),
      provider: provider.name,
      returnUrl: command.returnUrl ?? '',
    });

    const begin = await this.deps.idempotency.begin({
      merchantScope: scope,
      key: idempotencyKey,
      operationType: 'create_payment',
      fingerprint,
    });

    if (begin.outcome === 'conflict') {
      throw new IdempotencyKeyConflictError(idempotencyKey.toString());
    }

    if (begin.outcome === 'replay') {
      return this.handleReplay(scope, idempotencyKey, begin.record.paymentId, command);
    }

    const payment = Payment.create({
      merchantScope: scope,
      idempotencyKey,
      providerName: provider.name,
      amount,
    });

    await this.deps.payments.save(payment);
    await this.deps.idempotency.attachPayment(
      scope,
      idempotencyKey,
      'create_payment',
      payment.getId(),
    );

    return this.invokeProvider(payment, command, scope, idempotencyKey, false);
  }

  private async handleReplay(
    scope: MerchantScope,
    idempotencyKey: IdempotencyKey,
    paymentId: PaymentId | null,
    command: CreatePaymentCommand,
  ): Promise<PaymentOperationResult> {
    let payment = await this.loadPaymentForReplay(scope, idempotencyKey, paymentId);
    payment = await this.waitForInFlightCreate(scope, idempotencyKey, payment);

    const provider = this.deps.providers.resolve(payment.getProviderName());
    const idempotencyRecord = await this.deps.idempotency.find(
      scope,
      idempotencyKey,
      'create_payment',
    );

    // Ambiguous prior outcome with a provider reference: reconcile only.
    if (
      (payment.getStatus() === PaymentStatus.UNKNOWN ||
        payment.getStatus() === PaymentStatus.PROCESSING) &&
      payment.getProviderReference() !== null
    ) {
      payment = await reconcileWithProvider(payment, provider, this.deps.payments);

      if (
        payment.getStatus() === PaymentStatus.SUCCEEDED ||
        payment.getStatus() === PaymentStatus.FAILED ||
        payment.getStatus() === PaymentStatus.REQUIRES_ACTION
      ) {
        await this.deps.idempotency.complete(scope, idempotencyKey, 'create_payment', 'completed');
      }

      return {
        payment: payment.toSnapshot(),
        replayed: true,
        status: payment.getStatus(),
      };
    }

    // Timeout / crash recovery: retry create only after waiting, when the
    // provider supports idempotency keys, and local state is UNKNOWN (timeout)
    // or still CREATED after the in-flight wait budget (crash before PROCESSING).
    // Concurrent losers must not reach this path while the winner is in-flight.
    const canSafelyRetryCreate =
      payment.getProviderReference() === null &&
      idempotencyRecord?.state === 'started' &&
      (payment.getStatus() === PaymentStatus.UNKNOWN ||
        payment.getStatus() === PaymentStatus.CREATED) &&
      provider.getCapabilities().supportsIdempotencyKey;

    if (canSafelyRetryCreate) {
      return this.invokeProvider(payment, command, scope, idempotencyKey, true);
    }

    return {
      payment: payment.toSnapshot(),
      replayed: true,
      status: payment.getStatus(),
    };
  }

  /**
   * Concurrent losers must not call the provider while the winner still holds
   * a `started` idempotency row with CREATED/PROCESSING and no provider
   * reference. Yield until the create settles or the attempt budget is exhausted.
   */
  private async waitForInFlightCreate(
    scope: MerchantScope,
    idempotencyKey: IdempotencyKey,
    initial: Payment,
  ): Promise<Payment> {
    let payment = initial;
    const maxAttempts = 100;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const record = await this.deps.idempotency.find(scope, idempotencyKey, 'create_payment');

      if (record?.state === 'completed' || record?.state === 'failed') {
        const latest = await this.deps.payments.findByIdInScope(scope, payment.getId());
        return latest ?? payment;
      }

      const winnerStillInFlight =
        payment.getProviderReference() === null &&
        (payment.getStatus() === PaymentStatus.CREATED ||
          payment.getStatus() === PaymentStatus.PROCESSING);

      if (!winnerStillInFlight) {
        return payment;
      }

      await Promise.resolve();
      const reloaded = await this.deps.payments.findByIdInScope(scope, payment.getId());
      if (reloaded !== null) {
        payment = reloaded;
      }
    }

    return payment;
  }

  /**
   * Concurrent losers may observe the idempotency row before the winner has
   * attached/saved the payment. Poll briefly (yielding to the event loop) —
   * durable implementations should use the same pattern or SKIP LOCKED / notify.
   */
  private async loadPaymentForReplay(
    scope: MerchantScope,
    idempotencyKey: IdempotencyKey,
    paymentId: PaymentId | null,
  ): Promise<Payment> {
    const maxAttempts = 50;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (paymentId !== null) {
        const byId = await this.deps.payments.findByIdInScope(scope, paymentId);
        if (byId !== null) {
          return byId;
        }
      }

      const record = await this.deps.idempotency.find(scope, idempotencyKey, 'create_payment');
      if (record?.paymentId !== null && record?.paymentId !== undefined) {
        const attached = await this.deps.payments.findByIdInScope(scope, record.paymentId);
        if (attached !== null) {
          return attached;
        }
      }

      const byKey = await this.deps.payments.findByIdempotencyKey(scope, idempotencyKey);
      if (byKey !== null) {
        return byKey;
      }

      await Promise.resolve();
    }

    throw new PaymentNotFoundError(paymentId?.toString() ?? idempotencyKey.toString());
  }

  private async invokeProvider(
    payment: Payment,
    command: CreatePaymentCommand,
    scope: MerchantScope,
    idempotencyKey: IdempotencyKey,
    replayed: boolean,
  ): Promise<PaymentOperationResult> {
    const provider = this.deps.providers.resolve(payment.getProviderName());
    const capabilities = provider.getCapabilities();

    if (payment.getStatus() === PaymentStatus.CREATED) {
      payment.transitionTo(PaymentStatus.PROCESSING);
      await this.deps.payments.save(payment);
    } else if (payment.getStatus() === PaymentStatus.UNKNOWN) {
      // Stay UNKNOWN until the provider answers; do not invent PROCESSING.
      await this.deps.payments.save(payment);
    }

    const metadata: Record<string, string> = { ...(command.metadata ?? {}) };
    const createRequest = {
      paymentId: payment.getId(),
      amount: payment.getAmount(),
      ...(command.returnUrl !== undefined ? { returnUrl: command.returnUrl } : {}),
      ...(capabilities.supportsIdempotencyKey
        ? { idempotencyKey: idempotencyKey.toString() }
        : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };

    try {
      const result = await provider.createPayment(createRequest);

      if (result.outcome === 'succeeded') {
        if (payment.getStatus() === PaymentStatus.UNKNOWN) {
          payment.transitionTo(PaymentStatus.SUCCEEDED, {
            providerReference: result.providerReference,
          });
        } else {
          payment.transitionTo(PaymentStatus.SUCCEEDED, {
            providerReference: result.providerReference,
          });
        }
      } else if (result.outcome === 'failed') {
        payment.transitionTo(PaymentStatus.FAILED, {
          providerReference: result.providerReference,
          failureReason: result.reason,
        });
      } else if (payment.getStatus() === PaymentStatus.PROCESSING) {
        payment.transitionTo(PaymentStatus.REQUIRES_ACTION, {
          providerReference: result.providerReference,
          redirectUrl: result.redirectUrl,
        });
      } else {
        payment.transitionTo(PaymentStatus.REQUIRES_ACTION, {
          providerReference: result.providerReference,
          redirectUrl: result.redirectUrl,
        });
      }

      await this.deps.payments.save(payment);
      await this.deps.idempotency.complete(scope, idempotencyKey, 'create_payment', 'completed');

      return {
        payment: payment.toSnapshot(),
        replayed,
        status: payment.getStatus(),
      };
    } catch (error) {
      if (error instanceof ProviderUnknownOutcomeError) {
        if (payment.getStatus() === PaymentStatus.PROCESSING) {
          payment.transitionTo(PaymentStatus.UNKNOWN);
        } else if (payment.getStatus() !== PaymentStatus.UNKNOWN) {
          // CREATED should not happen here; if it does, move via PROCESSING first.
          if (payment.getStatus() === PaymentStatus.CREATED) {
            payment.transitionTo(PaymentStatus.PROCESSING);
          }
          if (payment.getStatus() === PaymentStatus.PROCESSING) {
            payment.transitionTo(PaymentStatus.UNKNOWN);
          }
        }
        await this.deps.payments.save(payment);

        return {
          payment: payment.toSnapshot(),
          replayed,
          status: payment.getStatus(),
        };
      }

      throw error;
    }
  }
}

export const CREATE_PAYMENT_USE_CASE = Symbol('CREATE_PAYMENT_USE_CASE');
