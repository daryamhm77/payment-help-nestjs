import { PaymentKitError } from './payment-kit-error';

/**
 * Raised when constructing a value object (Money, PaymentId, IdempotencyKey, ...)
 * with input that fails validation.
 */
export class InvalidAmountError extends PaymentKitError {
  public readonly code = 'PAYMENT_KIT.INVALID_AMOUNT';

  public constructor(amount: string) {
    super(`Amount must be a positive integer in minor units, received: ${amount}`);
  }
}

export class InvalidCurrencyError extends PaymentKitError {
  public readonly code = 'PAYMENT_KIT.INVALID_CURRENCY';

  public constructor(currency: string) {
    super(`Currency must be a valid ISO 4217 code (e.g. "USD", "IRR"), received: ${currency}`);
  }
}

export class InvalidPaymentIdError extends PaymentKitError {
  public readonly code = 'PAYMENT_KIT.INVALID_PAYMENT_ID';

  public constructor(value: string) {
    super(`PaymentId must be a valid UUID, received: ${value}`);
  }
}

export class InvalidIdempotencyKeyError extends PaymentKitError {
  public readonly code = 'PAYMENT_KIT.INVALID_IDEMPOTENCY_KEY';

  public constructor(value: string) {
    super(`IdempotencyKey must be between 8 and 255 characters, received: "${value}"`);
  }
}

/**
 * Raised when a requested state transition is not allowed by the payment state
 * machine (e.g. trying to move a SUCCEEDED payment back to PENDING).
 */
export class InvalidPaymentStateTransitionError extends PaymentKitError {
  public readonly code = 'PAYMENT_KIT.INVALID_STATE_TRANSITION';

  public constructor(from: string, to: string) {
    super(`Cannot transition payment from "${from}" to "${to}"`);
  }
}
