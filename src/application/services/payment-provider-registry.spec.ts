import { MockPaymentProviderAdapter } from '../../adapters/mock/mock-payment-provider.adapter';
import {
  InvalidProviderSelectionError,
  ProviderDisabledError,
  ProviderNotRegisteredError,
} from '../../domain/errors/payment-provider-errors';

import { PaymentProviderRegistry } from './payment-provider-registry';

describe('PaymentProviderRegistry', () => {
  const mock = new MockPaymentProviderAdapter();

  it('resolves the default provider when no name is supplied', () => {
    const registry = new PaymentProviderRegistry(
      { defaultProvider: 'mock', enabledProviders: ['mock'] },
      [mock],
    );

    expect(registry.resolve().name).toBe('mock');
  });

  it('resolves an explicitly requested enabled provider', () => {
    const registry = new PaymentProviderRegistry(
      { defaultProvider: 'mock', enabledProviders: ['mock'] },
      [mock],
    );

    expect(registry.resolve('mock').name).toBe('mock');
  });

  it('rejects disabled providers before looking up adapters', () => {
    const registry = new PaymentProviderRegistry(
      { defaultProvider: 'mock', enabledProviders: ['mock'] },
      [mock],
    );

    expect(() => registry.resolve('stripe')).toThrow(ProviderDisabledError);
  });

  it('rejects enabled but unregistered providers', () => {
    const registry = new PaymentProviderRegistry(
      { defaultProvider: 'mock', enabledProviders: ['mock', 'stripe'] },
      [mock],
    );

    expect(() => registry.resolve('stripe')).toThrow(ProviderNotRegisteredError);
  });

  it('rejects construction when the default provider is not enabled', () => {
    expect(
      () =>
        new PaymentProviderRegistry({ defaultProvider: 'stripe', enabledProviders: ['mock'] }, [
          mock,
        ]),
    ).toThrow(InvalidProviderSelectionError);
  });

  it('rejects duplicate provider registrations', () => {
    expect(
      () =>
        new PaymentProviderRegistry({ defaultProvider: 'mock', enabledProviders: ['mock'] }, [
          mock,
          new MockPaymentProviderAdapter(),
        ]),
    ).toThrow(InvalidProviderSelectionError);
  });

  it('lists only selectable (registered + enabled) providers', () => {
    const registry = new PaymentProviderRegistry(
      { defaultProvider: 'mock', enabledProviders: ['mock', 'zarinpal'] },
      [mock],
    );

    expect(registry.listSelectable()).toEqual(['mock']);
    expect(registry.listRegistered()).toEqual(['mock']);
    expect(registry.isEnabled('zarinpal')).toBe(true);
    expect(registry.has('zarinpal')).toBe(false);
  });
});
