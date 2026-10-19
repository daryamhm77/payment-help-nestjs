import { PaymentKitError } from '../errors/payment-kit-error';

export class InvalidMerchantScopeError extends PaymentKitError {
  public readonly code = 'PAYMENT_KIT.INVALID_MERCHANT_SCOPE';

  public constructor(value: string) {
    super(
      `MerchantScope must be 1–128 characters of [A-Za-z0-9_.:-], received: "${value}"`,
    );
  }
}

const SCOPE_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/**
 * Tenant / application boundary for payments and idempotency keys.
 * Keys are unique per scope so two merchants can safely reuse the same key string.
 */
export class MerchantScope {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  public static fromString(value: string): MerchantScope {
    const trimmed = value.trim();

    if (!SCOPE_PATTERN.test(trimmed)) {
      throw new InvalidMerchantScopeError(value);
    }

    return new MerchantScope(trimmed);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: MerchantScope): boolean {
    return this.value === other.value;
  }
}
