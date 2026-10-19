import { Money } from '../../domain/value-objects/money.vo';
import { PaymentId } from '../../domain/value-objects/payment-id.vo';

export interface RefundPaymentRequest {
  readonly paymentId: PaymentId;
  readonly providerReference: string;
  /** Amount to refund; must not exceed the original charge. */
  readonly amount: Money;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Definitive refund outcomes. Timeouts / ambiguous provider responses must
 * throw {@link ProviderUnknownOutcomeError} so callers reconcile instead of
 * assuming the refund failed (or succeeded).
 */
export type RefundPaymentResult =
  | {
      readonly outcome: 'succeeded';
      readonly refundReference: string;
      readonly providerReference: string;
    }
  | {
      readonly outcome: 'failed';
      readonly providerReference: string;
      readonly reason: string;
    };
