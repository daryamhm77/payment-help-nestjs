/**
 * Raw inbound webhook payload as received by the host application.
 * Signature verification is the adapter's responsibility when the provider
 * supports it; the mock adapter only simulates that contract.
 */
export interface ParseWebhookRequest {
  /** Raw request body bytes or UTF-8 string, provider-dependent. */
  readonly rawBody: string | Buffer;
  /** HTTP headers relevant to signature verification (lower-cased keys preferred). */
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

export type NormalizedWebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.processing'
  | 'refund.succeeded'
  | 'refund.failed'
  | 'unhandled';

/**
 * Provider-agnostic webhook event. No SDK-specific fields — only opaque
 * references and a stable event id for idempotent processing.
 */
export interface NormalizedWebhookEvent {
  /** Stable id from the provider (or synthesized by the mock) for deduplication. */
  readonly eventId: string;
  readonly type: NormalizedWebhookEventType;
  /** Opaque provider charge / authority reference, when known. */
  readonly providerReference: string | null;
  /** Opaque refund reference, when the event is refund-related. */
  readonly refundReference: string | null;
  /**
   * True when this exact `eventId` was already delivered. Host apps must treat
   * duplicates as no-ops; they must not re-apply side effects.
   */
  readonly isDuplicate: boolean;
  readonly occurredAt: Date;
  /** Free-form, already-normalized string bag — never provider SDK objects. */
  readonly metadata: Readonly<Record<string, string>>;
}
