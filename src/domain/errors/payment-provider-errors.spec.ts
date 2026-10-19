import { PaymentKitError } from './payment-kit-error';
import {
  InvalidProviderSelectionError,
  ProviderDefinitiveFailureError,
  ProviderDisabledError,
  ProviderError,
  ProviderNotRegisteredError,
  ProviderOperationNotSupportedError,
  ProviderUnknownOutcomeError,
} from './payment-provider-errors';

describe('provider error hierarchy', () => {
  it('distinguishes definitive failure from unknown outcome by type', () => {
    const definitive = new ProviderDefinitiveFailureError('stripe', 'card declined');
    const unknown = new ProviderUnknownOutcomeError('stripe', 'request timed out');

    expect(definitive).toBeInstanceOf(ProviderError);
    expect(unknown).toBeInstanceOf(ProviderError);
    expect(definitive).not.toBeInstanceOf(ProviderUnknownOutcomeError);
    expect(unknown).not.toBeInstanceOf(ProviderDefinitiveFailureError);
    expect(definitive.code).toBe('PAYMENT_KIT.PROVIDER_DEFINITIVE_FAILURE');
    expect(unknown.code).toBe('PAYMENT_KIT.PROVIDER_UNKNOWN_OUTCOME');
  });

  it('carries the originating provider name on every provider error', () => {
    const error = new ProviderUnknownOutcomeError('zarinpal', 'network error');

    expect(error.providerName).toBe('zarinpal');
  });

  it('every payment-kit error exposes a stable machine-readable code', () => {
    const errors: PaymentKitError[] = [
      new ProviderDefinitiveFailureError('mock', 'declined'),
      new ProviderUnknownOutcomeError('mock', 'timeout'),
      new ProviderOperationNotSupportedError('mock', 'refund'),
      new ProviderNotRegisteredError('unknown-provider'),
      new ProviderDisabledError('stripe'),
      new InvalidProviderSelectionError('bad selection'),
    ];

    for (const error of errors) {
      expect(typeof error.code).toBe('string');
      expect(error.code.startsWith('PAYMENT_KIT.')).toBe(true);
      expect(error).toBeInstanceOf(Error);
    }
  });

  it('preserves the original cause for debugging when provided', () => {
    const cause = new Error('socket hang up');
    const error = new ProviderUnknownOutcomeError('stripe', 'timeout', { cause });

    expect(error.cause).toBe(cause);
  });
});

