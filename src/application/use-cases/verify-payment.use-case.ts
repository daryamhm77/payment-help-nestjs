import {
  IdempotencyKeyConflictError,
  PaymentNotFoundError,
  PaymentNotVerifiableError,
} from '../../domain/errors/payment-persistence-errors';
import { ProviderUnknownOutcomeError } from '../../domain/errors/payment-provider-errors';
import { PaymentStatus } from '../../domain/payment-status';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key.vo';
import { MerchantScope } from '../../domain/value-objects/merchant-scope.vo';
import { PaymentId } from '../../domain/value-objects/payment-id.vo';
import { PaymentOperationResult, VerifyPaymentCommand } from '../dto/orchestration.dto';
import { IdempotencyStorePort } from '../ports/idempotency-store.port';
import { PaymentRepositoryPort } from '../ports/payment-repository.port';
import { PaymentProviderRegistry } from '../services/payment-provider-registry';
import { fingerprintPayload } from '../services/request-fingerprint';

export interface VerifyPaymentUseCaseDeps {
  readonly payments: PaymentRepositoryPort;
  readonly idempotency: IdempotencyStorePort;
  readonly providers: PaymentProviderRegistry;
}

/**
 * Verifies a payment with the provider after redirect / callback.
 *
 * Critical safety rules:
 * - A browser redirect alone must never mark the payment SUCCEEDED.
 * - Re-verifying an already SUCCEEDED payment is a no-op (no second capture).
 * - Idempotent under `(scope, verify key)`.
 */
export class VerifyPaymentUseCase {
  public constructor(private readonly deps: VerifyPaymentUseCaseDeps) {}

  public async execute(command: VerifyPaymentCommand): Promise<PaymentOperationResult> {
    const scope = MerchantScope.fromString(command.merchantScope);
    const paymentId = PaymentId.fromString(command.paymentId);
    const payment = await this.deps.payments.findByIdInScope(scope, paymentId);

    if (payment === null) {
      throw new PaymentNotFoundError(command.paymentId);
    }

    // Already captured — duplicate verify must not cause duplicate effects.
    if (
      payment.getStatus() === PaymentStatus.SUCCEEDED ||
      payment.getStatus() === PaymentStatus.REFUNDED
    ) {
      return {
        payment: payment.toSnapshot(),
        replayed: true,
        status: payment.getStatus(),
      };
    }

    if (payment.getStatus() === PaymentStatus.FAILED) {
      return {
        payment: payment.toSnapshot(),
        replayed: true,
        status: payment.getStatus(),
      };
    }

    const providerReference = payment.getProviderReference();
    if (providerReference === null) {
      throw new PaymentNotVerifiableError(
        payment.getId().toString(),
        'missing provider reference — redirect alone is not proof of payment',
      );
    }

    const verifyKey = IdempotencyKey.fromString(
      command.idempotencyKey ?? `verify:${payment.getId().toString()}`,
    );

    const fingerprint = fingerprintPayload({
      scope: scope.toString(),
      paymentId: payment.getId().toString(),
      providerReference,
      amount: payment.getAmount().getAmountInMinorUnits().toString(),
      currency: payment.getAmount().getCurrency(),
    });

    const begin = await this.deps.idempotency.begin({
      merchantScope: scope,
      key: verifyKey,
      operationType: 'verify_payment',
      fingerprint,
    });

    if (begin.outcome === 'conflict') {
      throw new IdempotencyKeyConflictError(verifyKey.toString());
    }

    if (begin.outcome === 'replay') {
      const latest = await this.deps.payments.findByIdInScope(scope, paymentId);
      if (latest === null) {
        throw new PaymentNotFoundError(command.paymentId);
      }
      return {
        payment: latest.toSnapshot(),
        replayed: true,
        status: latest.getStatus(),
      };
    }

    await this.deps.idempotency.attachPayment(
      scope,
      verifyKey,
      'verify_payment',
      payment.getId(),
    );

    const provider = this.deps.providers.resolve(payment.getProviderName());

    try {
      const result = await provider.verifyPayment({
        paymentId: payment.getId(),
        providerReference,
        amount: payment.getAmount(),
        ...(command.metadata !== undefined ? { metadata: command.metadata } : {}),
      });

      if (result.outcome === 'succeeded') {
        if (payment.getStatus() !== PaymentStatus.SUCCEEDED) {
          payment.transitionTo(PaymentStatus.SUCCEEDED, {
            providerReference: result.providerReference,
          });
          await this.deps.payments.save(payment);
        }
      } else {
        payment.transitionTo(PaymentStatus.FAILED, {
          providerReference: result.providerReference,
          failureReason: result.reason,
        });
        await this.deps.payments.save(payment);
      }

      await this.deps.idempotency.complete(scope, verifyKey, 'verify_payment', 'completed');

      return {
        payment: payment.toSnapshot(),
        replayed: false,
        status: payment.getStatus(),
      };
    } catch (error) {
      if (error instanceof ProviderUnknownOutcomeError) {
        if (
          payment.getStatus() === PaymentStatus.REQUIRES_ACTION ||
          payment.getStatus() === PaymentStatus.PROCESSING
        ) {
          payment.transitionTo(PaymentStatus.UNKNOWN);
          await this.deps.payments.save(payment);
        }

        return {
          payment: payment.toSnapshot(),
          replayed: false,
          status: payment.getStatus(),
        };
      }

      throw error;
    }
  }
}

export const VERIFY_PAYMENT_USE_CASE = Symbol('VERIFY_PAYMENT_USE_CASE');
