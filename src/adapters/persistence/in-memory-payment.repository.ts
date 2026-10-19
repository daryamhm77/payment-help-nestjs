import { PaymentRepositoryPort } from '../../application/ports/payment-repository.port';
import { Payment } from '../../domain/payment.entity';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key.vo';
import { MerchantScope } from '../../domain/value-objects/merchant-scope.vo';
import { PaymentId } from '../../domain/value-objects/payment-id.vo';

/**
 * **Test / local-dev double only.** Production hosts must supply a durable
 * {@link PaymentRepositoryPort} (e.g. Postgres). This Map is not crash-safe.
 */
export class InMemoryPaymentRepository implements PaymentRepositoryPort {
  private readonly byId = new Map<string, Payment>();

  public save(payment: Payment): Promise<void> {
    // Re-store from snapshot so callers cannot mutate shared instances.
    const snapshot = payment.toSnapshot();
    const copy = Payment.restore({
      id: payment.getId(),
      merchantScope: payment.getMerchantScope(),
      idempotencyKey: payment.getIdempotencyKey(),
      providerName: snapshot.providerName,
      amount: payment.getAmount(),
      status: snapshot.status,
      providerReference: snapshot.providerReference,
      redirectUrl: snapshot.redirectUrl,
      failureReason: snapshot.failureReason,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    });
    this.byId.set(copy.getId().toString(), copy);
    return Promise.resolve();
  }

  public findById(id: PaymentId): Promise<Payment | null> {
    return Promise.resolve(this.byId.get(id.toString()) ?? null);
  }

  public async findByIdInScope(scope: MerchantScope, id: PaymentId): Promise<Payment | null> {
    const payment = await this.findById(id);
    if (payment === null) {
      return null;
    }
    return payment.belongsToScope(scope) ? payment : null;
  }

  public findByIdempotencyKey(scope: MerchantScope, key: IdempotencyKey): Promise<Payment | null> {
    for (const payment of this.byId.values()) {
      if (
        payment.belongsToScope(scope) &&
        payment.getIdempotencyKey().equals(key)
      ) {
        return Promise.resolve(payment);
      }
    }
    return Promise.resolve(null);
  }
}
