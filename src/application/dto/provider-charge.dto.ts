import { Money } from '../../domain/value-objects/money.vo';
import { PaymentId } from '../../domain/value-objects/payment-id.vo';

/**
 * Input required by a provider adapter to start a charge. Framework-agnostic:
 * contains only domain value objects and primitives.
 */
export interface CreatePaymentRequest {
  readonly paymentId: PaymentId;
  readonly amount: Money;
  /** URL the customer's browser should be redirected back to, if applicable. */
  readonly returnUrl?: string;
  /**
   * Application idempotency key, forwarded ONLY when
   * `ProviderCapabilities.supportsIdempotencyKey` is true.
   */
  readonly idempotencyKey?: string;
  /** Free-form metadata forwarded to the provider when supported. */
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * @deprecated Use {@link CreatePaymentRequest}. Kept as an alias for existing callers.
 */
export type ChargeRequest = CreatePaymentRequest;

/**
 * Discriminated union describing the three possible *definitive* outcomes of
 * a charge attempt that the provider adapter was able to confirm:
 *
 * - `redirect_required`: the customer must be sent to `redirectUrl` to
 *   complete authentication/payment (maps to `PaymentStatus.REQUIRES_ACTION`).
 * - `succeeded`: the charge was captured (maps to `PaymentStatus.SUCCEEDED`).
 * - `failed`: the provider gave a definitive negative answer (maps to
 *   `PaymentStatus.FAILED`).
 *
 * Note there is intentionally no "unknown" member here: adapters signal an
 * unconfirmed outcome by *throwing* {@link ProviderUnknownOutcomeError} instead
 * of returning a result, so callers cannot accidentally ignore the ambiguity.
 */
export type CreatePaymentResult =
  | {
      readonly outcome: 'redirect_required';
      readonly redirectUrl: string;
      readonly providerReference: string;
    }
  | { readonly outcome: 'succeeded'; readonly providerReference: string }
  | {
      readonly outcome: 'failed';
      readonly providerReference: string | null;
      readonly reason: string;
    };

/**
 * @deprecated Use {@link CreatePaymentResult}.
 */
export type ChargeResult = CreatePaymentResult;

export interface GetPaymentStatusRequest {
  readonly paymentId: PaymentId;
  readonly providerReference: string | null;
}

/**
 * Result of querying the current status of a previously initiated charge.
 * Used for reconciliation after a {@link ProviderUnknownOutcomeError}.
 */
export type PaymentStatusResult =
  | { readonly outcome: 'succeeded'; readonly providerReference: string }
  | {
      readonly outcome: 'failed';
      readonly providerReference: string | null;
      readonly reason: string;
    }
  | { readonly outcome: 'processing' }
  | { readonly outcome: 'unknown' };

/**
 * @deprecated Use {@link PaymentStatusResult}.
 */
export type ChargeStatusResult = PaymentStatusResult;
