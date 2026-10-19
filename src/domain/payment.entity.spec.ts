import { InvalidPaymentStateTransitionError } from './errors/payment-domain-errors';
import { PaymentStatus } from './payment-status';
import { Payment } from './payment.entity';
import { IdempotencyKey } from './value-objects/idempotency-key.vo';
import { MerchantScope } from './value-objects/merchant-scope.vo';
import { Money } from './value-objects/money.vo';

function createTestPayment(): Payment {
  return Payment.create({
    merchantScope: MerchantScope.fromString('merchant_a'),
    idempotencyKey: IdempotencyKey.fromString('test-idempotency-key-1'),
    providerName: 'mock',
    amount: Money.fromMinorUnits(1000, 'USD'),
  });
}

describe('Payment entity', () => {
  it('starts in the CREATED state with merchant scope', () => {
    const payment = createTestPayment();

    expect(payment.getStatus()).toBe(PaymentStatus.CREATED);
    expect(payment.isTerminal()).toBe(false);
    expect(payment.getProviderReference()).toBeNull();
    expect(payment.getMerchantScope().toString()).toBe('merchant_a');
  });

  it('transitions through the happy path and records the provider reference', () => {
    const payment = createTestPayment();

    payment.transitionTo(PaymentStatus.PROCESSING);
    payment.transitionTo(PaymentStatus.SUCCEEDED, { providerReference: 'ref-123' });

    expect(payment.getStatus()).toBe(PaymentStatus.SUCCEEDED);
    expect(payment.getProviderReference()).toBe('ref-123');
    expect(payment.isTerminal()).toBe(false);
  });

  it('rejects an invalid transition and leaves the entity state unchanged', () => {
    const payment = createTestPayment();
    const updatedAtBefore = payment.getUpdatedAt();

    expect(() => payment.transitionTo(PaymentStatus.SUCCEEDED)).toThrow(
      InvalidPaymentStateTransitionError,
    );
    expect(payment.getStatus()).toBe(PaymentStatus.CREATED);
    expect(payment.getUpdatedAt()).toEqual(updatedAtBefore);
  });

  it('moves to UNKNOWN after a provider timeout instead of guessing a terminal state', () => {
    const payment = createTestPayment();

    payment.transitionTo(PaymentStatus.PROCESSING);
    payment.transitionTo(PaymentStatus.UNKNOWN);

    expect(payment.getStatus()).toBe(PaymentStatus.UNKNOWN);
    expect(payment.isTerminal()).toBe(false);
  });

  it('allows reconciling an UNKNOWN payment into a terminal state', () => {
    const payment = createTestPayment();

    payment.transitionTo(PaymentStatus.PROCESSING);
    payment.transitionTo(PaymentStatus.UNKNOWN);
    payment.transitionTo(PaymentStatus.SUCCEEDED, { providerReference: 'ref-456' });

    expect(payment.getStatus()).toBe(PaymentStatus.SUCCEEDED);
    expect(payment.getProviderReference()).toBe('ref-456');
  });

  it('allows refunding a succeeded payment', () => {
    const payment = createTestPayment();
    payment.transitionTo(PaymentStatus.PROCESSING);
    payment.transitionTo(PaymentStatus.SUCCEEDED, { providerReference: 'ref-1' });
    payment.transitionTo(PaymentStatus.REFUNDED);

    expect(payment.getStatus()).toBe(PaymentStatus.REFUNDED);
    expect(payment.isTerminal()).toBe(true);
  });

  it('restores a payment from a persisted snapshot without re-running transition validation', () => {
    const original = createTestPayment();
    original.transitionTo(PaymentStatus.PROCESSING);

    const snapshot = original.toSnapshot();
    const restored = Payment.restore({
      id: original.getId(),
      merchantScope: original.getMerchantScope(),
      idempotencyKey: original.getIdempotencyKey(),
      providerName: snapshot.providerName,
      amount: original.getAmount(),
      status: snapshot.status,
      providerReference: snapshot.providerReference,
      redirectUrl: snapshot.redirectUrl,
      failureReason: snapshot.failureReason,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    });

    expect(restored.getStatus()).toBe(PaymentStatus.PROCESSING);
    expect(restored.getId().equals(original.getId())).toBe(true);
    expect(restored.getMerchantScope().equals(original.getMerchantScope())).toBe(true);
  });

  it('produces a serializable snapshot with minor-unit amount as a string', () => {
    const payment = createTestPayment();
    const snapshot = payment.toSnapshot();

    expect(snapshot.amountInMinorUnits).toBe('1000');
    expect(snapshot.currency).toBe('USD');
    expect(snapshot.merchantScope).toBe('merchant_a');
    expect(snapshot.status).toBe(PaymentStatus.CREATED);
  });
});
