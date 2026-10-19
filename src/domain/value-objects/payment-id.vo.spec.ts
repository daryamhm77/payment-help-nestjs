import { InvalidPaymentIdError } from '../errors/payment-domain-errors';

import { PaymentId } from './payment-id.vo';

describe('PaymentId', () => {
  it('generates a unique UUID-based id', () => {
    const a = PaymentId.generate();
    const b = PaymentId.generate();

    expect(a.equals(b)).toBe(false);
  });

  it('parses a valid UUID string', () => {
    const id = PaymentId.generate();
    const parsed = PaymentId.fromString(id.toString());

    expect(parsed.equals(id)).toBe(true);
  });

  it('rejects malformed ids', () => {
    expect(() => PaymentId.fromString('not-a-uuid')).toThrow(InvalidPaymentIdError);
  });
});
