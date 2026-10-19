import { PaymentKitError } from './payment-kit-error';

/**
 * Base class for every error raised while talking to an external payment
 * provider (adapter layer). Subclasses communicate the *certainty* of the
 * outcome so the application layer can decide how to react:
 *
 * - {@link ProviderDefinitiveFailureError}: the provider has clearly rejected or
 *   failed the operation. It is safe to mark the payment as FAILED and allow a
 *   new payment attempt.
 * - {@link ProviderUnknownOutcomeError}: the call could not be confirmed either
 *   way (timeout, network error, 5xx, ambiguous webhook, ...). The payment MUST
 *   be left in PENDING/PROCESSING and reconciled later (e.g. via a status
 *   query or webhook) instead of being retried blindly, to avoid double charges.
 */
export abstract class ProviderError extends PaymentKitError {
  /** Identifier of the provider that raised the error (e.g. "stripe", "mock"). */
  public readonly providerName: string;

  protected constructor(providerName: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.providerName = providerName;
  }
}

/**
 * The provider has given a clear, final negative answer (e.g. card declined,
 * invalid request, authentication failure). Safe to treat as a terminal
 * failure and let the caller retry with a new payment attempt.
 */
export class ProviderDefinitiveFailureError extends ProviderError {
  public readonly code = 'PAYMENT_KIT.PROVIDER_DEFINITIVE_FAILURE';
  public readonly providerErrorCode: string | undefined;

  public constructor(
    providerName: string,
    message: string,
    options?: { providerErrorCode?: string; cause?: unknown },
  ) {
    super(providerName, message, { cause: options?.cause });
    this.providerErrorCode = options?.providerErrorCode;
  }
}

/**
 * The outcome of the operation could not be determined (timeout, network
 * failure, provider unavailable, ambiguous response). The payment must stay in
 * a non-terminal state until reconciled; it must NOT be retried blindly nor
 * marked as failed, since the charge may have actually succeeded upstream.
 */
export class ProviderUnknownOutcomeError extends ProviderError {
  public readonly code = 'PAYMENT_KIT.PROVIDER_UNKNOWN_OUTCOME';

  public constructor(providerName: string, message: string, options?: { cause?: unknown }) {
    super(providerName, message, options);
  }
}

/**
 * Raised when a provider adapter is asked to perform an operation it does not
 * support (e.g. refunds before they are implemented).
 */
export class ProviderOperationNotSupportedError extends ProviderError {
  public readonly code = 'PAYMENT_KIT.PROVIDER_OPERATION_NOT_SUPPORTED';

  public constructor(providerName: string, operation: string) {
    super(providerName, `Provider "${providerName}" does not support operation "${operation}"`);
  }
}

/**
 * Raised when no provider is registered for the requested provider key.
 */
export class ProviderNotRegisteredError extends PaymentKitError {
  public readonly code = 'PAYMENT_KIT.PROVIDER_NOT_REGISTERED';

  public constructor(providerName: string) {
    super(`No payment provider registered for key "${providerName}"`);
  }
}

/**
 * Raised when a provider exists in the catalog but is not listed in
 * `enabledProviders` for the current process. Selection must fail closed.
 */
export class ProviderDisabledError extends PaymentKitError {
  public readonly code = 'PAYMENT_KIT.PROVIDER_DISABLED';

  public constructor(providerName: string) {
    super(`Payment provider "${providerName}" is disabled by configuration`);
  }
}

/**
 * Raised when the configured default provider is missing from `enabledProviders`
 * or is otherwise invalid at module bootstrap.
 */
export class InvalidProviderSelectionError extends PaymentKitError {
  public readonly code = 'PAYMENT_KIT.INVALID_PROVIDER_SELECTION';

  public constructor(message: string) {
    super(message);
  }
}
