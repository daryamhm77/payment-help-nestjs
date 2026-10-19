import {
  IdempotencyKeyConflictError,
  PaymentNotFoundError,
  PaymentNotRefundableError,
} from '../../domain/errors/payment-persistence-errors';
import { ProviderUnknownOutcomeError } from '../../domain/errors/payment-provider-errors';
import { PaymentStatus } from '../../domain/payment-status';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key.vo';
import { MerchantScope } from '../../domain/value-objects/merchant-scope.vo';
import { Money } from '../../domain/value-objects/money.vo';
import { PaymentId } from '../../domain/value-objects/payment-id.vo';
import { PaymentOperationResult, RefundPaymentCommand } from '../dto/orchestration.dto';
import { IdempotencyStorePort } from '../ports/idempotency-store.port';
import { PaymentRepositoryPort } from '../ports/payment-repository.port';
import { PaymentProviderRegistry } from '../services/payment-provider-registry';
import { fingerprintPayload } from '../services/request-fingerprint';

export interface RefundPaymentUseCaseDeps {
  readonly payments: PaymentRepositoryPort;
  readonly idempotency: IdempotencyStorePort;
  readonly providers: PaymentProviderRegistry;
}

/**
 * Refunds a SUCCEEDED payment. Idempotent under `(scope, refund key)`.
 * Provider idempotency key is forwarded only when supported.
 */
export class RefundPaymentUseCase {
  public constructor(private readonly deps: RefundPaymentUseCaseDeps) {}

  public async execute(command: RefundPaymentCommand): Promise<PaymentOperationResult> {
    const scope = MerchantScope.fromString(command.merchantScope);
    const paymentId = PaymentId.fromString(command.paymentId);
    const refundKey = IdempotencyKey.fromString(command.idempotencyKey);
    const payment = await this.deps.payments.findByIdInScope(scope, paymentId);

    if (payment === null) {
      throw new PaymentNotFoundError(command.paymentId);
    }

    if (payment.getStatus() === PaymentStatus.REFUNDED) {
      return {
        payment: payment.toSnapshot(),
        replayed: true,
        status: payment.getStatus(),
      };
    }

    if (payment.getStatus() !== PaymentStatus.SUCCEEDED) {
      throw new PaymentNotRefundableError(payment.getId().toString(), payment.getStatus());
    }

    const providerReference = payment.getProviderReference();
    if (providerReference === null) {
      throw new PaymentNotRefundableError(payment.getId().toString(), 'missing_provider_reference');
    }

    const refundAmount =
      command.amountInMinorUnits !== undefined
        ? Money.fromMinorUnits(
            command.amountInMinorUnits,
            command.currency ?? payment.getAmount().getCurrency(),
          )
        : payment.getAmount();

    const fingerprint = fingerprintPayload({
      scope: scope.toString(),
      paymentId: payment.getId().toString(),
      amount: refundAmount.getAmountInMinorUnits().toString(),
      currency: refundAmount.getCurrency(),
      providerReference,
    });

    const begin = await this.deps.idempotency.begin({
      merchantScope: scope,
      key: refundKey,
      operationType: 'refund_payment',
      fingerprint,
    });

    if (begin.outcome === 'conflict') {
      throw new IdempotencyKeyConflictError(refundKey.toString());
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
      refundKey,
      'refund_payment',
      payment.getId(),
    );

    const provider = this.deps.providers.resolve(payment.getProviderName());
    const capabilities = provider.getCapabilities();

    try {
      const result = await provider.refundPayment({
        paymentId: payment.getId(),
        providerReference,
        amount: refundAmount,
        ...(command.reason !== undefined ? { reason: command.reason } : {}),
        ...(capabilities.supportsIdempotencyKey
          ? {
              metadata: {
                ...(command.metadata ?? {}),
                idempotencyKey: refundKey.toString(),
              },
            }
          : command.metadata !== undefined
            ? { metadata: command.metadata }
            : {}),
      });

      if (result.outcome === 'succeeded') {
        payment.transitionTo(PaymentStatus.REFUNDED);
        await this.deps.payments.save(payment);
        await this.deps.idempotency.complete(scope, refundKey, 'refund_payment', 'completed');
      } else {
        await this.deps.idempotency.complete(scope, refundKey, 'refund_payment', 'failed');
      }

      return {
        payment: payment.toSnapshot(),
        replayed: false,
        status: payment.getStatus(),
      };
    } catch (error) {
      if (error instanceof ProviderUnknownOutcomeError) {
        // Leave SUCCEEDED; do not mark REFUNDED. Caller may retry with same key.
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

export const REFUND_PAYMENT_USE_CASE = Symbol('REFUND_PAYMENT_USE_CASE');
