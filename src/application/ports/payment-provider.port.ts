import { ProviderCapabilities } from '../dto/provider-capabilities.dto';
import {
  CreatePaymentRequest,
  CreatePaymentResult,
  GetPaymentStatusRequest,
  PaymentStatusResult,
} from '../dto/provider-charge.dto';
import { RefundPaymentRequest, RefundPaymentResult } from '../dto/provider-refund.dto';
import { VerifyPaymentRequest, VerifyPaymentResult } from '../dto/provider-verify.dto';
import { NormalizedWebhookEvent, ParseWebhookRequest } from '../dto/provider-webhook.dto';

/**
 * Port that every payment provider adapter must implement. The application
 * layer depends only on this interface, never on a concrete provider SDK.
 *
 * Contract for implementers:
 * - Resolve with a result ONLY when the outcome is definitively known.
 * - Reject with `ProviderUnknownOutcomeError` when the outcome cannot be
 *   confirmed (timeout, network error, 5xx, ambiguous response). Never guess.
 * - Reject with `ProviderDefinitiveFailureError` only when the provider gave a
 *   clear negative answer that an exception is more appropriate for than a
 *   `failed` result (e.g. invalid credentials). Business-level declines should
 *   prefer the `failed` variant of the result union.
 * - Reject with `ProviderOperationNotSupportedError` when
 *   {@link PaymentProviderPort.getCapabilities} reports the operation as false.
 * - Never silently claim to verify or settle a payment that this adapter did
 *   not itself create (foreign provider references must fail closed).
 */
export interface PaymentProviderPort {
  /** Stable identifier of this provider, e.g. "mock", "stripe", "zarinpal". */
  readonly name: string;

  /** Declares which operations this adapter supports. */
  getCapabilities(): ProviderCapabilities;

  /** Initiates a payment / charge with the upstream provider. */
  createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult>;

  /**
   * Confirms a payment after redirect / callback. Iranian gateways typically
   * require this step; card processors may treat it as a status fetch.
   */
  verifyPayment(request: VerifyPaymentRequest): Promise<VerifyPaymentResult>;

  /**
   * Queries the current status of a previously initiated payment. Used to
   * reconcile payments left in `UNKNOWN` or `PROCESSING` after a timeout.
   */
  getPaymentStatus(request: GetPaymentStatusRequest): Promise<PaymentStatusResult>;

  /** Refunds a previously succeeded payment (full or partial). */
  refundPayment(request: RefundPaymentRequest): Promise<RefundPaymentResult>;

  /**
   * Parses and (when applicable) signature-verifies a provider webhook into a
   * normalized event. Duplicate deliveries must set `isDuplicate: true`.
   */
  parseWebhookEvent(request: ParseWebhookRequest): Promise<NormalizedWebhookEvent>;
}

/**
 * Injection token for a multi-provider array registered with the NestJS module.
 */
export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');

/**
 * Injection token for the typed provider registry.
 */
export const PAYMENT_PROVIDER_REGISTRY = Symbol('PAYMENT_PROVIDER_REGISTRY');
