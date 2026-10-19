import { IdempotencyKey } from '../../domain/value-objects/idempotency-key.vo';
import { MerchantScope } from '../../domain/value-objects/merchant-scope.vo';
import { PaymentId } from '../../domain/value-objects/payment-id.vo';

/**
 * Fingerprint of the request payload associated with an idempotency key.
 * Used to detect a key being replayed with a different payload.
 * Computation (typically a stable hash) lives in the application layer.
 */
export type RequestFingerprint = string;

/**
 * Logical operation covered by an idempotency record. Composite uniqueness is
 * `(merchantScope, key, operationType)` so create / verify / refund keys do
 * not collide when the caller reuses the same string.
 */
export type IdempotencyOperationType =
  | 'create_payment'
  | 'verify_payment'
  | 'refund_payment';

/**
 * Durable lifecycle of an idempotent operation.
 *
 * - `started`: row reserved; the associated payment may still be in-flight or
 *   UNKNOWN. Retries must resume / reconcile — never create a second provider
 *   payment blindly.
 * - `completed`: terminal success path for this operation (payment resource is
 *   the source of truth for financial state).
 * - `failed`: the operation definitively failed before producing a usable
 *   resource (rare; prefer attaching a FAILED payment and completing).
 */
export type IdempotencyOperationState = 'started' | 'completed' | 'failed';

/**
 * Persisted idempotency row. Designed for a durable relational (or equivalent)
 * store with a UNIQUE constraint on `(scope, key, operationType)`.
 *
 * **Not** satisfied by Redis TTL alone or a process-local Map in production.
 * Those may be used only as test doubles that still honour the same atomic
 * begin/attach/complete semantics.
 */
export interface IdempotencyRecord {
  readonly merchantScope: string;
  readonly key: string;
  readonly operationType: IdempotencyOperationType;
  readonly fingerprint: RequestFingerprint;
  readonly state: IdempotencyOperationState;
  /** Set once the local payment aggregate has been inserted. */
  readonly paymentId: PaymentId | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BeginIdempotentOperationInput {
  readonly merchantScope: MerchantScope;
  readonly key: IdempotencyKey;
  readonly operationType: IdempotencyOperationType;
  readonly fingerprint: RequestFingerprint;
}

export type BeginIdempotentOperationResult =
  | { readonly outcome: 'acquired'; readonly record: IdempotencyRecord }
  | { readonly outcome: 'replay'; readonly record: IdempotencyRecord }
  | { readonly outcome: 'conflict'; readonly record: IdempotencyRecord };

/**
 * Port for at-most-once initiation of payment operations.
 *
 * Intended durable implementation sketch (Postgres):
 * ```sql
 * CREATE TABLE payment_idempotency (
 *   merchant_scope TEXT NOT NULL,
 *   idempotency_key TEXT NOT NULL,
 *   operation_type TEXT NOT NULL,
 *   fingerprint TEXT NOT NULL,
 *   state TEXT NOT NULL,
 *   payment_id UUID NULL,
 *   created_at TIMESTAMPTZ NOT NULL,
 *   updated_at TIMESTAMPTZ NOT NULL,
 *   PRIMARY KEY (merchant_scope, idempotency_key, operation_type)
 * );
 * ```
 * `begin` = INSERT … ON CONFLICT DO NOTHING returning + SELECT; compare
 * fingerprint in the application. Never wrap the external provider HTTP call
 * inside the same DB transaction as this insert.
 */
export interface IdempotencyStorePort {
  /**
   * Atomically reserves a new operation row, or returns the existing one.
   * Implementations MUST make concurrent `begin` calls for the same composite
   * key safe (unique constraint / serializable write).
   */
  begin(input: BeginIdempotentOperationInput): Promise<BeginIdempotentOperationResult>;

  /**
   * Associates the already-persisted local payment with this idempotency row.
   * Called after `PaymentRepositoryPort.save`, before (or after) the provider
   * call — never as a substitute for persisting the payment itself.
   */
  attachPayment(
    merchantScope: MerchantScope,
    key: IdempotencyKey,
    operationType: IdempotencyOperationType,
    paymentId: PaymentId,
  ): Promise<void>;

  /**
   * Marks the operation finished. Does not encode financial success — that
   * lives on the {@link Payment} aggregate.
   */
  complete(
    merchantScope: MerchantScope,
    key: IdempotencyKey,
    operationType: IdempotencyOperationType,
    state: 'completed' | 'failed',
  ): Promise<void>;

  find(
    merchantScope: MerchantScope,
    key: IdempotencyKey,
    operationType: IdempotencyOperationType,
  ): Promise<IdempotencyRecord | null>;
}

export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');
