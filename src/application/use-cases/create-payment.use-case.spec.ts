import { MockPaymentProviderAdapter } from '../../adapters/mock/mock-payment-provider.adapter';
import { InMemoryIdempotencyStore } from '../../adapters/persistence/in-memory-idempotency.store';
import { InMemoryPaymentRepository } from '../../adapters/persistence/in-memory-payment.repository';
import { IdempotencyKeyConflictError } from '../../domain/errors/payment-persistence-errors';
import { PaymentStatus } from '../../domain/payment-status';
import { Payment } from '../../domain/payment.entity';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key.vo';
import { MerchantScope } from '../../domain/value-objects/merchant-scope.vo';
import { Money } from '../../domain/value-objects/money.vo';
import { PaymentProviderRegistry } from '../services/payment-provider-registry';

import { CreatePaymentUseCase } from './create-payment.use-case';
import { GetPaymentStatusUseCase } from './get-payment-status.use-case';
import { RefundPaymentUseCase } from './refund-payment.use-case';
import { VerifyPaymentUseCase } from './verify-payment.use-case';

function buildHarness(mockOptions: ConstructorParameters<typeof MockPaymentProviderAdapter>[0] = {}) {
  const mock = new MockPaymentProviderAdapter(mockOptions);
  const payments = new InMemoryPaymentRepository();
  const idempotency = new InMemoryIdempotencyStore();
  const providers = new PaymentProviderRegistry(
    { defaultProvider: 'mock', enabledProviders: ['mock'] },
    [mock],
  );

  return {
    mock,
    payments,
    idempotency,
    create: new CreatePaymentUseCase({ payments, idempotency, providers }),
    verify: new VerifyPaymentUseCase({ payments, idempotency, providers }),
    status: new GetPaymentStatusUseCase({ payments, providers }),
    refund: new RefundPaymentUseCase({ payments, idempotency, providers }),
  };
}

describe('CreatePaymentUseCase', () => {
  it('creates a succeeded payment on the happy path', async () => {
    const { create } = buildHarness();

    const result = await create.execute({
      merchantScope: 'shop_1',
      idempotencyKey: 'order-create-0001',
      amountInMinorUnits: 2500,
      currency: 'IRR',
    });

    expect(result.replayed).toBe(false);
    expect(result.status).toBe(PaymentStatus.SUCCEEDED);
    expect(result.payment.amountInMinorUnits).toBe('2500');
    expect(result.payment.providerReference).toMatch(/^mock_ref_/);
  });

  it('replays the same scope+key+payload without creating another payment', async () => {
    const { create, mock } = buildHarness();
    const command = {
      merchantScope: 'shop_1',
      idempotencyKey: 'order-create-0002',
      amountInMinorUnits: 1000,
      currency: 'USD',
    };

    const first = await create.execute(command);
    const second = await create.execute(command);

    expect(second.replayed).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
    expect(mock.getCreateCallCount()).toBe(1);
  });

  it('rejects the same key with a different payload', async () => {
    const { create } = buildHarness();

    await create.execute({
      merchantScope: 'shop_1',
      idempotencyKey: 'order-create-0003',
      amountInMinorUnits: 1000,
      currency: 'USD',
    });

    await expect(
      create.execute({
        merchantScope: 'shop_1',
        idempotencyKey: 'order-create-0003',
        amountInMinorUnits: 2000,
        currency: 'USD',
      }),
    ).rejects.toThrow(IdempotencyKeyConflictError);
  });

  it('handles concurrent create requests safely (single logical payment)', async () => {
    const { create, mock } = buildHarness();
    const command = {
      merchantScope: 'shop_1',
      idempotencyKey: 'order-create-concurrent',
      amountInMinorUnits: 500,
      currency: 'EUR',
    };

    const results = await Promise.all([
      create.execute(command),
      create.execute(command),
      create.execute(command),
    ]);

    const ids = new Set(results.map((r) => r.payment.id));
    expect(ids.size).toBe(1);
    expect(results.every((r) => r.status === PaymentStatus.SUCCEEDED)).toBe(true);
    expect(mock.getCreateCallCount()).toBe(1);
  });

  it('marks UNKNOWN on timeout and retries keep the same payment id', async () => {
    const { create, mock } = buildHarness({ defaultScenario: 'timeout' });

    const first = await create.execute({
      merchantScope: 'shop_1',
      idempotencyKey: 'order-create-timeout',
      amountInMinorUnits: 1000,
      currency: 'USD',
    });

    expect(first.status).toBe(PaymentStatus.UNKNOWN);

    const second = await create.execute({
      merchantScope: 'shop_1',
      idempotencyKey: 'order-create-timeout',
      amountInMinorUnits: 1000,
      currency: 'USD',
    });

    expect(second.payment.id).toBe(first.payment.id);
    expect(second.replayed).toBe(true);
    // May retry provider create with the same idempotency key; never a new local payment.
    expect(mock.getCreateCallCount()).toBeGreaterThanOrEqual(1);
  });

  it('recovers UNKNOWN via provider status when a provider reference exists (no second create)', async () => {
    const { create, status, payments, mock } = buildHarness();

    const created = await create.execute({
      merchantScope: 'shop_1',
      idempotencyKey: 'order-create-reconcile',
      amountInMinorUnits: 1000,
      currency: 'USD',
    });

    const scope = MerchantScope.fromString('shop_1');
    const key = IdempotencyKey.fromString('order-create-reconcile');
    const payment = await payments.findByIdempotencyKey(scope, key);
    expect(payment).not.toBeNull();
    if (payment === null) {
      return;
    }

    // Simulate a prior timeout after the provider had already accepted the charge.
    const ambiguous = Payment.restore({
      id: payment.getId(),
      merchantScope: payment.getMerchantScope(),
      idempotencyKey: payment.getIdempotencyKey(),
      providerName: payment.getProviderName(),
      amount: payment.getAmount(),
      status: PaymentStatus.UNKNOWN,
      providerReference: payment.getProviderReference(),
      redirectUrl: null,
      failureReason: null,
      createdAt: payment.getCreatedAt(),
      updatedAt: new Date(),
    });
    await payments.save(ambiguous);

    const before = mock.getCreateCallCount();
    const reconciled = await status.execute({
      merchantScope: 'shop_1',
      paymentId: created.payment.id,
      reconcile: true,
    });

    expect(reconciled.status).toBe(PaymentStatus.SUCCEEDED);
    expect(mock.getCreateCallCount()).toBe(before);
  });
});

describe('VerifyPaymentUseCase', () => {
  it('returns existing SUCCEEDED without re-applying financial effects', async () => {
    const { create, verify, mock } = buildHarness();

    const created = await create.execute({
      merchantScope: 'shop_1',
      idempotencyKey: 'order-verify-1',
      amountInMinorUnits: 1000,
      currency: 'USD',
    });

    const verified = await verify.execute({
      merchantScope: 'shop_1',
      paymentId: created.payment.id,
    });

    expect(verified.status).toBe(PaymentStatus.SUCCEEDED);
    expect(verified.replayed).toBe(true);
    expect(mock.getCreateCallCount()).toBe(1);
  });

  it('verifies REQUIRES_ACTION via provider and is idempotent on replay', async () => {
    const payments = new InMemoryPaymentRepository();
    const idempotency = new InMemoryIdempotencyStore();
    const mock = new MockPaymentProviderAdapter({ defaultScenario: 'success' });
    const providers = new PaymentProviderRegistry(
      { defaultProvider: 'mock', enabledProviders: ['mock'] },
      [mock],
    );

    const payment = Payment.create({
      merchantScope: MerchantScope.fromString('shop_1'),
      idempotencyKey: IdempotencyKey.fromString('order-verify-2'),
      providerName: 'mock',
      amount: Money.fromMinorUnits(1000, 'USD'),
    });
    payment.transitionTo(PaymentStatus.PROCESSING);
    payment.transitionTo(PaymentStatus.REQUIRES_ACTION, {
      providerReference: `mock_ref_${payment.getId().toString()}`,
      redirectUrl: 'https://mock-provider.local/pay',
    });
    mock.seedSucceededCharge({
      paymentId: payment.getId().toString(),
      providerReference: `mock_ref_${payment.getId().toString()}`,
      amountMinor: '1000',
      currency: 'USD',
    });
    await payments.save(payment);

    const verify = new VerifyPaymentUseCase({ payments, idempotency, providers });

    const first = await verify.execute({
      merchantScope: 'shop_1',
      paymentId: payment.getId().toString(),
      idempotencyKey: 'verify-key-abc12345',
    });
    const second = await verify.execute({
      merchantScope: 'shop_1',
      paymentId: payment.getId().toString(),
      idempotencyKey: 'verify-key-abc12345',
    });

    expect(first.status).toBe(PaymentStatus.SUCCEEDED);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.status).toBe(PaymentStatus.SUCCEEDED);
  });

  it('refuses to verify without a provider reference (redirect is not proof)', async () => {
    const payments = new InMemoryPaymentRepository();
    const idempotency = new InMemoryIdempotencyStore();
    const mock = new MockPaymentProviderAdapter();
    const providers = new PaymentProviderRegistry(
      { defaultProvider: 'mock', enabledProviders: ['mock'] },
      [mock],
    );

    const payment = Payment.create({
      merchantScope: MerchantScope.fromString('shop_1'),
      idempotencyKey: IdempotencyKey.fromString('order-verify-3'),
      providerName: 'mock',
      amount: Money.fromMinorUnits(1000, 'USD'),
    });
    await payments.save(payment);

    const verify = new VerifyPaymentUseCase({ payments, idempotency, providers });

    await expect(
      verify.execute({
        merchantScope: 'shop_1',
        paymentId: payment.getId().toString(),
      }),
    ).rejects.toThrow(/redirect alone is not proof/);
  });
});

describe('RefundPaymentUseCase', () => {
  it('refunds a succeeded payment idempotently', async () => {
    const { create, refund } = buildHarness({ defaultScenario: 'refund_success' });

    const created = await create.execute({
      merchantScope: 'shop_1',
      idempotencyKey: 'order-refund-1',
      amountInMinorUnits: 1000,
      currency: 'USD',
    });

    const first = await refund.execute({
      merchantScope: 'shop_1',
      paymentId: created.payment.id,
      idempotencyKey: 'refund-key-0001',
    });
    const second = await refund.execute({
      merchantScope: 'shop_1',
      paymentId: created.payment.id,
      idempotencyKey: 'refund-key-0001',
    });

    expect(first.status).toBe(PaymentStatus.REFUNDED);
    expect(second.replayed).toBe(true);
    expect(second.status).toBe(PaymentStatus.REFUNDED);
  });
});
