import { InvalidProviderSelectionError } from '../../domain/errors/payment-provider-errors';

import {
  parseEnabledProviders,
  paymentKitConfigFromEnvironment,
  validatePaymentKitConfig,
  validatePaymentKitEnvironment,
} from './payment-kit-config.schema';

describe('validatePaymentKitEnvironment', () => {
  it('applies defaults when no environment variables are set', () => {
    const config = validatePaymentKitEnvironment({});

    expect(config.PAYMENT_KIT_DEFAULT_PROVIDER).toBe('mock');
    expect(config.PAYMENT_KIT_IDEMPOTENCY_KEY_TTL_SECONDS).toBe(86_400);
  });

  it('accepts a valid, fully specified configuration', () => {
    const config = validatePaymentKitEnvironment({
      PAYMENT_KIT_DEFAULT_PROVIDER: 'stripe',
      PAYMENT_KIT_IDEMPOTENCY_KEY_TTL_SECONDS: '3600',
      PAYMENT_KIT_ENABLED_PROVIDERS: 'stripe,mock',
    });

    expect(config.PAYMENT_KIT_DEFAULT_PROVIDER).toBe('stripe');
    expect(config.PAYMENT_KIT_IDEMPOTENCY_KEY_TTL_SECONDS).toBe(3600);
    expect(config.PAYMENT_KIT_ENABLED_PROVIDERS).toBe('stripe,mock');
  });

  it('rejects an unsupported provider name', () => {
    expect(() => validatePaymentKitEnvironment({ PAYMENT_KIT_DEFAULT_PROVIDER: 'paypal' })).toThrow(
      /Invalid nestjs-payment-kit environment configuration/,
    );
  });

  it('rejects a non-positive TTL', () => {
    expect(() =>
      validatePaymentKitEnvironment({ PAYMENT_KIT_IDEMPOTENCY_KEY_TTL_SECONDS: '0' }),
    ).toThrow(/Invalid nestjs-payment-kit environment configuration/);
  });

  it('rejects a non-integer TTL', () => {
    expect(() =>
      validatePaymentKitEnvironment({ PAYMENT_KIT_IDEMPOTENCY_KEY_TTL_SECONDS: '12.5' }),
    ).toThrow(/Invalid nestjs-payment-kit environment configuration/);
  });
});

describe('parseEnabledProviders', () => {
  it('defaults to the default provider when unset', () => {
    expect(parseEnabledProviders(undefined, 'mock')).toEqual(['mock']);
  });

  it('parses a comma-separated list', () => {
    expect(parseEnabledProviders('mock, stripe', 'mock')).toEqual(['mock', 'stripe']);
  });

  it('rejects unknown provider names', () => {
    expect(() => parseEnabledProviders('mock,paypal', 'mock')).toThrow(/unknown provider/);
  });
});

describe('validatePaymentKitConfig / paymentKitConfigFromEnvironment', () => {
  it('builds a config from environment defaults', () => {
    const config = paymentKitConfigFromEnvironment({});

    expect(config).toEqual({
      defaultProvider: 'mock',
      enabledProviders: ['mock'],
      idempotencyKeyTtlSeconds: 86_400,
    });
  });

  it('rejects a default provider that is not enabled', () => {
    expect(() =>
      validatePaymentKitConfig({
        defaultProvider: 'stripe',
        enabledProviders: ['mock'],
        idempotencyKeyTtlSeconds: 60,
      }),
    ).toThrow(InvalidProviderSelectionError);
  });

  it('accepts a valid programmatic config', () => {
    const config = validatePaymentKitConfig({
      defaultProvider: 'mock',
      enabledProviders: ['mock', 'zarinpal'],
      idempotencyKeyTtlSeconds: 120,
    });

    expect(config.enabledProviders).toEqual(['mock', 'zarinpal']);
  });
});
