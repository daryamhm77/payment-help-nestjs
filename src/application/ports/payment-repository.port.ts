import { Payment } from '../../domain/payment.entity';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key.vo';
import { MerchantScope } from '../../domain/value-objects/merchant-scope.vo';
import { PaymentId } from '../../domain/value-objects/payment-id.vo';

/**
 * Persistence port for the `Payment` aggregate. The application layer depends
 * only on this interface; concrete storage (Postgres, …) lives in
 * infrastructure. An in-memory double is provided for tests only.
 *
 * Durable implementations should enforce uniqueness of
 * `(merchantScope, idempotencyKey)` for create-payment rows (in addition to
 * the idempotency store) so a crash between the two writes cannot orphan
 * duplicates forever.
 */
export interface PaymentRepositoryPort {
  save(payment: Payment): Promise<void>;

  findById(id: PaymentId): Promise<Payment | null>;

  findByIdInScope(scope: MerchantScope, id: PaymentId): Promise<Payment | null>;

  findByIdempotencyKey(scope: MerchantScope, key: IdempotencyKey): Promise<Payment | null>;
}

export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');
