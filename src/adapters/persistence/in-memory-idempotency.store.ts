import {
  BeginIdempotentOperationInput,
  BeginIdempotentOperationResult,
  IdempotencyOperationState,
  IdempotencyOperationType,
  IdempotencyRecord,
  IdempotencyStorePort,
} from '../../application/ports/idempotency-store.port';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key.vo';
import { MerchantScope } from '../../domain/value-objects/merchant-scope.vo';
import { PaymentId } from '../../domain/value-objects/payment-id.vo';

/**
 * **Test / local-dev double only.** Simulates a durable unique-constraint
 * store by serializing mutations per composite key. Do not use as a
 * production idempotency backend — production must persist rows in a
 * database (see `IdempotencyStorePort` docs).
 */
export class InMemoryIdempotencyStore implements IdempotencyStorePort {
  private readonly records = new Map<string, MutableRecord>();
  /** Per-key promise chain approximating row-level locking / unique insert. */
  private readonly tails = new Map<string, Promise<unknown>>();

  public begin(input: BeginIdempotentOperationInput): Promise<BeginIdempotentOperationResult> {
    const mapKey = this.compositeKey(
      input.merchantScope.toString(),
      input.key.toString(),
      input.operationType,
    );

    return this.serialize(mapKey, (): Promise<BeginIdempotentOperationResult> => {
      const existing = this.records.get(mapKey);

      if (existing === undefined) {
        const now = new Date();
        const record: MutableRecord = {
          merchantScope: input.merchantScope.toString(),
          key: input.key.toString(),
          operationType: input.operationType,
          fingerprint: input.fingerprint,
          state: 'started',
          paymentId: null,
          createdAt: now,
          updatedAt: now,
        };
        this.records.set(mapKey, record);
        return Promise.resolve({ outcome: 'acquired', record: this.toPublic(record) });
      }

      if (existing.fingerprint !== input.fingerprint) {
        return Promise.resolve({ outcome: 'conflict', record: this.toPublic(existing) });
      }

      return Promise.resolve({ outcome: 'replay', record: this.toPublic(existing) });
    });
  }

  public attachPayment(
    merchantScope: MerchantScope,
    key: IdempotencyKey,
    operationType: IdempotencyOperationType,
    paymentId: PaymentId,
  ): Promise<void> {
    const mapKey = this.compositeKey(merchantScope.toString(), key.toString(), operationType);

    return this.serialize(mapKey, () => {
      const record = this.records.get(mapKey);
      if (record === undefined) {
        return Promise.reject(new Error(`Idempotency row not found for ${mapKey}`));
      }
      record.paymentId = paymentId;
      record.updatedAt = new Date();
      return Promise.resolve();
    });
  }

  public complete(
    merchantScope: MerchantScope,
    key: IdempotencyKey,
    operationType: IdempotencyOperationType,
    state: 'completed' | 'failed',
  ): Promise<void> {
    const mapKey = this.compositeKey(merchantScope.toString(), key.toString(), operationType);

    return this.serialize(mapKey, () => {
      const record = this.records.get(mapKey);
      if (record === undefined) {
        return Promise.reject(new Error(`Idempotency row not found for ${mapKey}`));
      }
      record.state = state;
      record.updatedAt = new Date();
      return Promise.resolve();
    });
  }

  public find(
    merchantScope: MerchantScope,
    key: IdempotencyKey,
    operationType: IdempotencyOperationType,
  ): Promise<IdempotencyRecord | null> {
    const mapKey = this.compositeKey(merchantScope.toString(), key.toString(), operationType);
    const record = this.records.get(mapKey);
    return Promise.resolve(record === undefined ? null : this.toPublic(record));
  }

  private compositeKey(scope: string, key: string, operationType: string): string {
    return `${scope}::${operationType}::${key}`;
  }

  private toPublic(record: MutableRecord): IdempotencyRecord {
    return {
      merchantScope: record.merchantScope,
      key: record.key,
      operationType: record.operationType,
      fingerprint: record.fingerprint,
      state: record.state,
      paymentId: record.paymentId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    this.tails.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }
}

interface MutableRecord {
  merchantScope: string;
  key: string;
  operationType: IdempotencyOperationType;
  fingerprint: string;
  state: IdempotencyOperationState;
  paymentId: PaymentId | null;
  createdAt: Date;
  updatedAt: Date;
}
