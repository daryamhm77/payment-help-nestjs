/**
 * Lifecycle states of a payment.
 *
 * ```
 *                 ┌────────────┐
 *        ┌───────▶│  REQUIRES_  │
 *        │        │   ACTION    │
 *        │        └──────┬──────┘
 *        │               │
 *  ┌─────┴─────┐   ┌──────▼──────┐    ┌───────────┐
 *  │  CREATED  │──▶│ PROCESSING  │───▶│ SUCCEEDED │ (terminal)
 *  └───────────┘   └──────┬──────┘    └───────────┘
 *        │                │
 *        │                ├──────────▶┌───────────┐
 *        │                │           │  FAILED   │ (terminal)
 *        │                │           └───────────┘
 *        │                │
 *        │                └──────────▶┌───────────┐
 *        │                            │  UNKNOWN  │ (requires reconciliation)
 *        │                                  │
 *        │                                  ├────▶ SUCCEEDED
 *        │                                  ├────▶ FAILED
 *        │                                  └────▶ UNKNOWN (re-check)
 *        │
 *        └───────────────────────────▶┌───────────┐
 *                                      │ CANCELED  │ (terminal)
 *                                      └───────────┘
 *
 *  SUCCEEDED ──▶ REFUNDED (terminal)
 * ```
 *
 * - `CREATED`: the payment intent exists locally but no provider call has been
 *   confirmed yet.
 * - `REQUIRES_ACTION`: the provider needs further customer action (3DS, redirect
 *   to a hosted page, OTP, ...) before the charge can complete. A browser
 *   redirect alone must NEVER be treated as success — verification / webhook
 *   / status query is required.
 * - `PROCESSING`: the charge has been submitted to the provider and a
 *   definitive result is pending.
 * - `SUCCEEDED`: the provider confirmed the funds were captured. Refundable.
 * - `FAILED`: terminal. The provider gave a definitive negative answer.
 * - `UNKNOWN`: the outcome could not be determined (timeout, network error,
 *   ambiguous webhook). This is deliberately NOT terminal and NOT equivalent to
 *   FAILED: the charge may have succeeded upstream. It must be resolved via
 *   reconciliation (status polling or webhook) before the payment can be
 *   considered final, to avoid double-charging the customer on retry.
 * - `CANCELED`: terminal. The payment was explicitly canceled before
 *   completion (e.g. customer abandoned, intent expired).
 * - `REFUNDED`: terminal. A full refund was confirmed by the provider.
 */
export enum PaymentStatus {
  CREATED = 'CREATED',
  REQUIRES_ACTION = 'REQUIRES_ACTION',
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  UNKNOWN = 'UNKNOWN',
  CANCELED = 'CANCELED',
  REFUNDED = 'REFUNDED',
}

/**
 * States from which the payment can never move again.
 */
export const TERMINAL_PAYMENT_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  PaymentStatus.FAILED,
  PaymentStatus.CANCELED,
  PaymentStatus.REFUNDED,
]);

/**
 * Allowed outgoing transitions for each status. This is the single source of
 * truth for valid state changes; `Payment.transitionTo` consults this table
 * and rejects anything not listed here.
 */
const ALLOWED_TRANSITIONS: Readonly<Record<PaymentStatus, ReadonlySet<PaymentStatus>>> = {
  [PaymentStatus.CREATED]: new Set([
    PaymentStatus.REQUIRES_ACTION,
    PaymentStatus.PROCESSING,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELED,
    PaymentStatus.UNKNOWN,
  ]),
  [PaymentStatus.REQUIRES_ACTION]: new Set([
    PaymentStatus.PROCESSING,
    PaymentStatus.SUCCEEDED,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELED,
    PaymentStatus.UNKNOWN,
  ]),
  [PaymentStatus.PROCESSING]: new Set([
    PaymentStatus.REQUIRES_ACTION,
    PaymentStatus.SUCCEEDED,
    PaymentStatus.FAILED,
    PaymentStatus.UNKNOWN,
  ]),
  [PaymentStatus.UNKNOWN]: new Set([
    PaymentStatus.REQUIRES_ACTION,
    PaymentStatus.SUCCEEDED,
    PaymentStatus.FAILED,
    PaymentStatus.UNKNOWN,
  ]),
  [PaymentStatus.SUCCEEDED]: new Set([PaymentStatus.REFUNDED]),
  [PaymentStatus.FAILED]: new Set([]),
  [PaymentStatus.CANCELED]: new Set([]),
  [PaymentStatus.REFUNDED]: new Set([]),
};

export function isTerminalStatus(status: PaymentStatus): boolean {
  return TERMINAL_PAYMENT_STATUSES.has(status);
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

export function getAllowedTransitions(from: PaymentStatus): ReadonlySet<PaymentStatus> {
  return ALLOWED_TRANSITIONS[from];
}
