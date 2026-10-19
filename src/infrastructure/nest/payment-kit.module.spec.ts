import { MockPaymentProviderAdapter } from '../../adapters/mock/mock-payment-provider.adapter';
import {
  PAYMENT_PROVIDER_REGISTRY,
  PAYMENT_PROVIDERS,
} from '../../application/ports/payment-provider.port';
import { PaymentProviderRegistry } from '../../application/services/payment-provider-registry';
import { ProviderNotRegisteredError } from '../../domain/errors/payment-provider-errors';
import { PAYMENT_KIT_CONFIG } from '../config/payment-kit-config.interface';

import { PaymentKitModule } from './payment-kit.module';

describe('PaymentKitModule', () => {
  it('forRoot registers mock when enabled and exports a working registry', () => {
    const dynamic = PaymentKitModule.forRoot({
      defaultProvider: 'mock',
      enabledProviders: ['mock'],
      idempotencyKeyTtlSeconds: 60,
    });

    expect(dynamic.exports).toEqual(
      expect.arrayContaining([PAYMENT_KIT_CONFIG, PAYMENT_PROVIDER_REGISTRY, PAYMENT_PROVIDERS]),
    );

    const providersProvider = dynamic.providers?.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'provide' in entry &&
        entry.provide === PAYMENT_PROVIDERS,
    );

    expect(providersProvider).toBeDefined();
    if (
      providersProvider === undefined ||
      typeof providersProvider !== 'object' ||
      !('useFactory' in providersProvider) ||
      typeof providersProvider.useFactory !== 'function'
    ) {
      throw new Error('PAYMENT_PROVIDERS factory missing');
    }

    const adapters = providersProvider.useFactory() as unknown[];
    expect(adapters).toHaveLength(1);
    expect(adapters[0]).toBeInstanceOf(MockPaymentProviderAdapter);

    const registryProvider = dynamic.providers?.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'provide' in entry &&
        entry.provide === PAYMENT_PROVIDER_REGISTRY,
    );

    expect(registryProvider).toBeDefined();
    if (
      registryProvider === undefined ||
      typeof registryProvider !== 'object' ||
      !('useFactory' in registryProvider) ||
      typeof registryProvider.useFactory !== 'function'
    ) {
      throw new Error('registry factory missing');
    }

    const registry = registryProvider.useFactory(
      {
        defaultProvider: 'mock',
        enabledProviders: ['mock'],
        idempotencyKeyTtlSeconds: 60,
      },
      adapters,
    ) as PaymentProviderRegistry;

    expect(registry.resolve().name).toBe('mock');
  });

  it('does not fabricate stripe/zarinpal adapters when they are enabled but unimplemented', () => {
    const dynamic = PaymentKitModule.forRoot({
      defaultProvider: 'mock',
      enabledProviders: ['mock', 'stripe'],
      idempotencyKeyTtlSeconds: 60,
    });

    const providersProvider = dynamic.providers?.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'provide' in entry &&
        entry.provide === PAYMENT_PROVIDERS,
    );

    if (
      providersProvider === undefined ||
      typeof providersProvider !== 'object' ||
      !('useFactory' in providersProvider) ||
      typeof providersProvider.useFactory !== 'function'
    ) {
      throw new Error('PAYMENT_PROVIDERS factory missing');
    }

    const adapters = providersProvider.useFactory() as unknown[];
    expect(adapters).toHaveLength(1);

    const registryProvider = dynamic.providers?.find(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'provide' in entry &&
        entry.provide === PAYMENT_PROVIDER_REGISTRY,
    );

    if (
      registryProvider === undefined ||
      typeof registryProvider !== 'object' ||
      !('useFactory' in registryProvider) ||
      typeof registryProvider.useFactory !== 'function'
    ) {
      throw new Error('registry factory missing');
    }

    const registry = registryProvider.useFactory(
      {
        defaultProvider: 'mock',
        enabledProviders: ['mock', 'stripe'],
        idempotencyKeyTtlSeconds: 60,
      },
      adapters,
    ) as PaymentProviderRegistry;

    expect(() => registry.resolve('stripe')).toThrow(ProviderNotRegisteredError);
  });
});
