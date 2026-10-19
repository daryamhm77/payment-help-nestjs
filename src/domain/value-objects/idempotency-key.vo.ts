import { InvalidIdempotencyKeyError } from '../errors/payment-domain-errors';

const MIN_LENGTH = 8;
const MAX_LENGTH = 255;

/**
 * Caller-supplied key used to guarantee that a payment intent is created at most
 * once, even if the request is retried. Must be stable across retries of the same
 * logical operation.
 */
export class IdempotencyKey {
  private readonly value: string;

  private constructor(value: string) {
    this.value = value;
  }

  public static fromString(value: string): IdempotencyKey {
    const trimmed = value.trim();

    if (trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH) {
      throw new InvalidIdempotencyKeyError(value);
    }

    return new IdempotencyKey(trimmed);
  }

  public toString(): string {
    return this.value;
  }

  public equals(other: IdempotencyKey): boolean {
    return this.value === other.value;
  }
}
