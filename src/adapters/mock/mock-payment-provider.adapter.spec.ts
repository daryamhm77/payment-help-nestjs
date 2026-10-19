import {
  ProviderDefinitiveFailureError,
  ProviderUnknownOutcomeError,
} from '../../domain/errors/payment-provider-errors';
import { Money } from '../../domain/value-objects/money.vo';
import { PaymentId } from '../../domain/value-objects/payment-id.vo';

import { createRecordingDelay, noDelay } from './mock-delay';
import { MockPaymentProviderAdapter } from './mock-payment-provider.adapter';
import { MOCK_SCENARIO_METADATA_KEY } from './mock-scenarios';

describe('MockPaymentProviderAdapter', () => {
  const amount = Money.fromMinorUnits(1000, 'USD');

  it('returns a succeeded result by default', async () => {
    const adapter = new MockPaymentProviderAdapter();
    const paymentId = PaymentId.generate();

    const result = await adapter.createPayment({ paymentId, amount });

    expect(result.outcome).toBe('succeeded');
    expect(adapter.name).toBe('mock');
  });

  it('returns a failed result when configured for declined', async () => {
    const adapter = new MockPaymentProviderAdapter({ defaultScenario: 'declined' });
    const paymentId = PaymentId.generate();

    const result = await adapter.createPayment({ paymentId, amount });

    expect(result.outcome).toBe('failed');
  });

  it('throws ProviderUnknownOutcomeError on timeout (never treats timeout as failure)', async () => {
    const adapter = new MockPaymentProviderAdapter({ defaultScenario: 'timeout' });
    const paymentId = PaymentId.generate();

    await expect(adapter.createPayment({ paymentId, amount })).rejects.toThrow(
      ProviderUnknownOutcomeError,
    );
  });

  it('throws ProviderUnknownOutcomeError for unknown outcome', async () => {
    const adapter = new MockPaymentProviderAdapter({ defaultScenario: 'unknown' });
    const paymentId = PaymentId.generate();

    await expect(adapter.createPayment({ paymentId, amount })).rejects.toThrow(
      ProviderUnknownOutcomeError,
    );
  });

  it('invokes the injected delay for the delayed scenario without requiring real timers', async () => {
    const recording = createRecordingDelay();
    const adapter = new MockPaymentProviderAdapter({
      defaultScenario: 'delayed',
      delayMs: 40,
      delay: recording.delay,
    });
    const paymentId = PaymentId.generate();

    const result = await adapter.createPayment({ paymentId, amount });

    expect(result.outcome).toBe('succeeded');
    expect(recording.calls).toEqual([40]);
  });

  it('allows per-request scenario overrides via metadata', async () => {
    const adapter = new MockPaymentProviderAdapter({ defaultScenario: 'success' });
    const paymentId = PaymentId.generate();

    await expect(
      adapter.createPayment({
        paymentId,
        amount,
        metadata: { [MOCK_SCENARIO_METADATA_KEY]: 'timeout' },
      }),
    ).rejects.toThrow(ProviderUnknownOutcomeError);
  });

  it('refuses to verify foreign provider references', async () => {
    const adapter = new MockPaymentProviderAdapter();
    const paymentId = PaymentId.generate();

    await expect(
      adapter.verifyPayment({
        paymentId,
        providerReference: 'stripe_pi_123',
        amount,
      }),
    ).rejects.toThrow(ProviderDefinitiveFailureError);
  });

  it('verifies a charge it previously created', async () => {
    const adapter = new MockPaymentProviderAdapter();
    const paymentId = PaymentId.generate();

    const created = await adapter.createPayment({ paymentId, amount });
    expect(created.outcome).toBe('succeeded');
    if (created.outcome !== 'succeeded') {
      return;
    }

    const verified = await adapter.verifyPayment({
      paymentId,
      providerReference: created.providerReference,
      amount,
    });

    expect(verified.outcome).toBe('succeeded');
  });

  it('refunds successfully under refund_success scenario', async () => {
    const adapter = new MockPaymentProviderAdapter({
      defaultScenario: 'refund_success',
      delay: noDelay,
    });
    const paymentId = PaymentId.generate();
    const created = await adapter.createPayment({ paymentId, amount });
    expect(created.outcome).toBe('succeeded');
    if (created.outcome !== 'succeeded') {
      return;
    }

    const refunded = await adapter.refundPayment({
      paymentId,
      providerReference: created.providerReference,
      amount,
    });

    expect(refunded.outcome).toBe('succeeded');
  });

  it('fails refunds under refund_failure scenario', async () => {
    const adapter = new MockPaymentProviderAdapter({ defaultScenario: 'refund_failure' });
    const paymentId = PaymentId.generate();
    const created = await adapter.createPayment({ paymentId, amount });
    expect(created.outcome).toBe('succeeded');
    if (created.outcome !== 'succeeded') {
      return;
    }

    const refunded = await adapter.refundPayment({
      paymentId,
      providerReference: created.providerReference,
      amount,
    });

    expect(refunded.outcome).toBe('failed');
  });

  it('marks webhook events as duplicates under duplicate_webhook scenario', async () => {
    const adapter = new MockPaymentProviderAdapter({ defaultScenario: 'duplicate_webhook' });

    const event = await adapter.parseWebhookEvent({
      rawBody: JSON.stringify({
        eventId: 'evt_1',
        type: 'payment.succeeded',
        providerReference: 'mock_ref_x',
      }),
      headers: {},
    });

    expect(event.isDuplicate).toBe(true);
  });

  it('detects a second delivery of the same webhook eventId as a duplicate', async () => {
    const adapter = new MockPaymentProviderAdapter({ defaultScenario: 'success' });
    const body = JSON.stringify({
      eventId: 'evt_2',
      type: 'payment.succeeded',
      providerReference: 'mock_ref_y',
    });

    const first = await adapter.parseWebhookEvent({ rawBody: body, headers: {} });
    const second = await adapter.parseWebhookEvent({ rawBody: body, headers: {} });

    expect(first.isDuplicate).toBe(false);
    expect(second.isDuplicate).toBe(true);
  });

  it('reports unknown status for a reference it has never seen', async () => {
    const adapter = new MockPaymentProviderAdapter();
    const paymentId = PaymentId.generate();

    const status = await adapter.getPaymentStatus({
      paymentId,
      providerReference: 'mock_ref_never-seen',
    });

    expect(status.outcome).toBe('unknown');
  });

  it('reconciles a successful charge reference to succeeded on status lookup', async () => {
    const adapter = new MockPaymentProviderAdapter({ defaultScenario: 'success' });
    const paymentId = PaymentId.generate();

    const chargeResult = await adapter.createPayment({ paymentId, amount });
    expect(chargeResult.outcome).toBe('succeeded');
    if (chargeResult.outcome !== 'succeeded') {
      return;
    }

    const status = await adapter.getPaymentStatus({
      paymentId,
      providerReference: chargeResult.providerReference,
    });

    expect(status.outcome).toBe('succeeded');
  });

  it('exposes full provider capabilities including idempotency key support', () => {
    const adapter = new MockPaymentProviderAdapter();

    expect(adapter.getCapabilities()).toEqual({
      createPayment: true,
      verifyPayment: true,
      getPaymentStatus: true,
      refundPayment: true,
      parseWebhookEvent: true,
      supportsIdempotencyKey: true,
    });
  });
});
