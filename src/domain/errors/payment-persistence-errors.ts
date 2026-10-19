import { PaymentKitError } from './payment-kit-error';

/**
 * Raised when an idempotent operation is replayed with the same idempotency
 * key but a different request payload (amount, currency, provider, ...),
 * which indicates a programming error or a key collision on the caller side.
 */
export class IdempotencyKeyConflictError extends PaymentKitError {
  public readonly code = 'PAYMENT_KIT.IDEMPOTENCY_KEY_CONFLICT';

  public constructor(key: string) {
    super(`Idempotency key "${key}" was already used with a different request payload`);
  }
}

/**
 * Raised when a lookup for a payment (by PaymentId) finds nothing.
 */
export class PaymentNotFoundError extends PaymentKitError {
  public readonly code = 'PAYMENT_KIT.PAYMENT_NOT_FOUND';

  public constructor(paymentId: string) {
    super(`Payment with id "${paymentId}" was not found`);
  }
}

/**
 * Raised when a payment exists but belongs to a different merchant scope.
 */
export class PaymentScopeMismatchError extends PaymentKitError {
  public readonly code = 'PAYMENT_KIT.PAYMENT_SCOPE_MISMATCH';

  public constructor(paymentId: string, scope: string) {
    super(`Payment "${paymentId}" does not belong to merchant scope "${scope}"`);
  }
}

/**
 * Raised when a refund is requested for a payment that is not in SUCCEEDED.
 */
export class PaymentNotRefundableError extends PaymentKitError {
  public readonly code = 'PAYMENT_KIT.PAYMENT_NOT_REFUNDABLE';

  public constructor(paymentId: string, status: string) {
    super(`Payment "${paymentId}" with status "${status}" cannot be refunded`);
  }
}

/**
 * Raised when verification is requested but there is no provider reference to
 * verify against (e.g. local CREATED with no upstream call yet).
 */
export class PaymentNotVerifiableError extends PaymentKitError {
  public readonly code = 'PAYMENT_KIT.PAYMENT_NOT_VERIFIABLE';

  public constructor(paymentId: string, reason: string) {
    super(`Payment "${paymentId}" cannot be verified: ${reason}`);
  }
}
