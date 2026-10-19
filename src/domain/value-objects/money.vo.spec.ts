import { InvalidAmountError, InvalidCurrencyError } from '../errors/payment-domain-errors';

import { Money } from './money.vo';

describe('Money', () => {
  it('creates a valid Money instance from minor units', () => {
    const money = Money.fromMinorUnits(1000, 'usd');

    expect(money.getAmountInMinorUnits()).toBe(BigInt(1000));
    expect(money.getCurrency()).toBe('USD');
  });

  it('accepts bigint amounts directly', () => {
    const money = Money.fromMinorUnits(BigInt(500), 'EUR');

    expect(money.getAmountInMinorUnits()).toBe(BigInt(500));
  });

  it('rejects zero or negative amounts', () => {
    expect(() => Money.fromMinorUnits(0, 'USD')).toThrow(InvalidAmountError);
    expect(() => Money.fromMinorUnits(-100, 'USD')).toThrow(InvalidAmountError);
  });

  it('rejects invalid currency codes', () => {
    expect(() => Money.fromMinorUnits(100, 'US')).toThrow(InvalidCurrencyError);
    expect(() => Money.fromMinorUnits(100, 'USDT1')).toThrow(InvalidCurrencyError);
    expect(() => Money.fromMinorUnits(100, '123')).toThrow(InvalidCurrencyError);
  });

  it('compares equality by amount and currency', () => {
    const a = Money.fromMinorUnits(1000, 'USD');
    const b = Money.fromMinorUnits(1000, 'USD');
    const c = Money.fromMinorUnits(1000, 'EUR');

    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});
