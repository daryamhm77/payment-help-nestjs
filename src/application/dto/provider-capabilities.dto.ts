/**
 * Declares which operations a payment provider adapter supports.
 * Application services consult this instead of hard-coding provider names.
 */
export interface ProviderCapabilities {
  readonly createPayment: boolean;
  readonly verifyPayment: boolean;
  readonly getPaymentStatus: boolean;
  readonly refundPayment: boolean;
  readonly parseWebhookEvent: boolean;
  /**
   * When true, the orchestration layer forwards the application idempotency
   * key on create/refund so the provider can dedupe. When false, the key is
   * kept local-only (never sent upstream).
   */
  readonly supportsIdempotencyKey: boolean;
}

export const FULL_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  createPayment: true,
  verifyPayment: true,
  getPaymentStatus: true,
  refundPayment: true,
  parseWebhookEvent: true,
  supportsIdempotencyKey: true,
};
