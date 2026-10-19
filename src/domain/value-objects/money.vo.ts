import { InvalidAmountError, InvalidCurrencyError } from '../errors/payment-domain-errors';

/**
 * ISO 4217 currency code, validated at construction time (3 uppercase letters).
 */
const ISO_4217_PATTERN = /^[A-Z]{3}$/;

/**
 * Represents a monetary amount in the smallest currency unit (e.g. cents for USD,
 * rials for IRR) to avoid floating point rounding errors. Immutable value object.
 */
export class Money {
  private readonly amountInMinorUnits: bigint;
  private readonly currency: string;

  private constructor(amountInMinorUnits: bigint, currency: string) {
    this.amountInMinorUnits = amountInMinorUnits;
    this.currency = currency;
  }

  public static fromMinorUnits(amount: number | bigint, currency: string): Money {
    const normalizedCurrency = currency.trim().toUpperCase();

    if (!ISO_4217_PATTERN.test(normalizedCurrency)) {
      throw new InvalidCurrencyError(currency);
    }

    const amountAsBigInt = typeof amount === 'bigint' ? amount : BigInt(Math.trunc(amount));

    if (amountAsBigInt <= BigInt(0)) {
      throw new InvalidAmountError(amount.toString());
    }

    return new Money(amountAsBigInt, normalizedCurrency);
  }

  public getAmountInMinorUnits(): bigint {
    return this.amountInMinorUnits;
  }

  public getCurrency(): string {
    return this.currency;
  }

  public equals(other: Money): boolean {
    return this.amountInMinorUnits === other.amountInMinorUnits && this.currency === other.currency;
  }

  public toString(): string {
    return `${this.amountInMinorUnits.toString()} ${this.currency}`;
  }
}
