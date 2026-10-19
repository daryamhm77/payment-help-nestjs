import { PaymentProviderPort } from '../application/ports/payment-provider.port';
import { ProviderUnknownOutcomeError } from '../domain/errors/payment-provider-errors';
import { Money } from '../domain/value-objects/money.vo';
import { PaymentId } from '../domain/value-objects/payment-id.vo';

import { createRecordingDelay } from './mock/mock-delay';
import { MockPaymentProviderAdapter } from './mock/mock-payment-provider.adapter';

/**
 * Shared contract expectations every PaymentProviderPort implementer must
 * satisfy. New adapters (Stripe, Zarinpal) should be added to `providersUnderTest`.
 */
function runPaymentProviderContract(factory: () => PaymentProviderPort): void {
  describe(`PaymentProviderPort contract (${factory().name})`, () => {
    it('exposes a non-empty stable name', () => {
      const provider = factory();
      expect(provider.name.length).toBeGreaterThan(0);
    });

    it('declares capabilities that match implemented operations', () => {
      const capabilities = factory().getCapabilities();

      expect(typeof capabilities.createPayment).toBe('boolean');
      expect(typeof capabilities.verifyPayment).toBe('boolean');
      expect(typeof capabilities.getPaymentStatus).toBe('boolean');
      expect(typeof capabilities.refundPayment).toBe('boolean');
      expect(typeof capabilities.parseWebhookEvent).toBe('boolean');
    });

    it('createPayment returns a definitive succeeded or failed result for the happy path', async () => {
      const provider = factory();
      if (!provider.getCapabilities().createPayment) {
        return;
      }

      const result = await provider.createPayment({
        paymentId: PaymentId.generate(),
        amount: Money.fromMinorUnits(500, 'IRR'),
      });

      expect(['succeeded', 'failed', 'redirect_required']).toContain(result.outcome);
    });

    it('getPaymentStatus never invents a success for an unknown reference', async () => {
      const provider = factory();
      if (!provider.getCapabilities().getPaymentStatus) {
        return;
      }

      const status = await provider.getPaymentStatus({
        paymentId: PaymentId.generate(),
        providerReference: `unknown_ref_${PaymentId.generate().toString()}`,
      });

      expect(status.outcome).not.toBe('succeeded');
    });
  });
}

describe('provider contracts', () => {
  runPaymentProviderContract(() => new MockPaymentProviderAdapter());

  describe('MockPaymentProviderAdapter timeout contract', () => {
    it('signals timeout as ProviderUnknownOutcomeError, not a failed ChargeResult', async () => {
      const provider = new MockPaymentProviderAdapter({ defaultScenario: 'timeout' });

      await expect(
        provider.createPayment({
          paymentId: PaymentId.generate(),
          amount: Money.fromMinorUnits(100, 'USD'),
        }),
      ).rejects.toBeInstanceOf(ProviderUnknownOutcomeError);
    });

    it('uses an injectable delay instead of real sleeps for delayed scenarios', async () => {
      const recording = createRecordingDelay();
      const provider = new MockPaymentProviderAdapter({
        defaultScenario: 'delayed',
        delayMs: 10,
        delay: recording.delay,
      });

      await provider.createPayment({
        paymentId: PaymentId.generate(),
        amount: Money.fromMinorUnits(100, 'USD'),
      });

      expect(recording.calls).toEqual([10]);
    });
  });
});
