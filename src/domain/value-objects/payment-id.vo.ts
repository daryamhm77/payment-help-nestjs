import { randomUUID } from 'node:crypto';

import { InvalidPaymentIdError } from '../errors/payment-domain-errors';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Unique identifier for a payment, internal to this library (not the provider's
 * own transaction id). Always a UUID v4 string.
 */
export class PaymentId {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  public static generate(): PaymentId {
    return new PaymentId(randomUUID());
  }

  public static fromString(value: string): PaymentId {
    if (!UUID_PATTERN.test(value)) {
      throw new InvalidPaymentIdError(value);
    }

    return new PaymentId(value);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: PaymentId): boolean {
    return this.value === other.value;
  }
}
