import { InvalidIdempotencyKeyError } from '../errors/payment-domain-errors';

import { IdempotencyKey } from './idempotency-key.vo';

describe('IdempotencyKey', () => {
  it('accepts a key within the allowed length range', () => {
    const key = IdempotencyKey.fromString('order-12345');

    expect(key.toString()).toBe('order-12345');
  });

  it('trims surrounding whitespace', () => {
    const key = IdempotencyKey.fromString('  order-12345  ');

    expect(key.toString()).toBe('order-12345');
  });

  it('rejects keys shorter than the minimum length', () => {
    expect(() => IdempotencyKey.fromString('short')).toThrow(InvalidIdempotencyKeyError);
  });

  it('rejects keys longer than the maximum length', () => {
    expect(() => IdempotencyKey.fromString('a'.repeat(256))).toThrow(InvalidIdempotencyKeyError);
  });

  it('compares equality by value', () => {
    const a = IdempotencyKey.fromString('order-12345');
    const b = IdempotencyKey.fromString('order-12345');

    expect(a.equals(b)).toBe(true);
  });
});
