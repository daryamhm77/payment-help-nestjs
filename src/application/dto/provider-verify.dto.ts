import { Money } from '../../domain/value-objects/money.vo';
import { PaymentId } from '../../domain/value-objects/payment-id.vo';

/**
 * Input for confirming a payment after a customer returns from a hosted
 * checkout / redirect flow (common with Iranian gateways).
 */
export interface VerifyPaymentRequest {
  readonly paymentId: PaymentId;
  readonly providerReference: string;
  /** Expected amount; adapters should reject mismatches when the provider reports one. */
  readonly amount: Money;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Definitive verify outcomes. Ambiguous results must be signaled by throwing
 * {@link ProviderUnknownOutcomeError}, never by returning a soft "maybe".
 */
export type VerifyPaymentResult =
  | { readonly outcome: 'succeeded'; readonly providerReference: string }
  | {
      readonly outcome: 'failed';
      readonly providerReference: string | null;
      readonly reason: string;
    };
