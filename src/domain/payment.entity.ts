import { InvalidPaymentStateTransitionError } from './errors/payment-domain-errors';
import { canTransition, isTerminalStatus, PaymentStatus } from './payment-status';
import { IdempotencyKey } from './value-objects/idempotency-key.vo';
import { MerchantScope } from './value-objects/merchant-scope.vo';
import { Money } from './value-objects/money.vo';
import { PaymentId } from './value-objects/payment-id.vo';

export interface PaymentSnapshot {
  readonly id: string;
  readonly merchantScope: string;
  readonly idempotencyKey: string;
  readonly providerName: string;
  readonly amountInMinorUnits: string;
  readonly currency: string;
  readonly status: PaymentStatus;
  readonly providerReference: string | null;
  readonly redirectUrl: string | null;
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CreatePaymentInput {
  readonly merchantScope: MerchantScope;
  readonly idempotencyKey: IdempotencyKey;
  readonly providerName: string;
  readonly amount: Money;
}

export interface RestorePaymentInput {
  readonly id: PaymentId;
  readonly merchantScope: MerchantScope;
  readonly idempotencyKey: IdempotencyKey;
  readonly providerName: string;
  readonly amount: Money;
  readonly status: PaymentStatus;
  readonly providerReference: string | null;
  readonly redirectUrl: string | null;
  readonly failureReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Core domain entity. Framework-free: no NestJS decorators, no ORM annotations,
 * no provider SDK types. All state transitions are funneled through
 * {@link Payment.transitionTo}, which enforces the rules defined in
 * `payment-status.ts`.
 *
 * Money is always integer minor units via {@link Money} — never floating point.
 */
export class Payment {
  private readonly id: PaymentId;
  private readonly merchantScope: MerchantScope;
  private readonly idempotencyKey: IdempotencyKey;
  private readonly providerName: string;
  private readonly amount: Money;
  private status: PaymentStatus;
  private providerReference: string | null;
  private redirectUrl: string | null;
  private failureReason: string | null;
  private readonly createdAt: Date;
  private updatedAt: Date;

  private constructor(params: {
    id: PaymentId;
    merchantScope: MerchantScope;
    idempotencyKey: IdempotencyKey;
    providerName: string;
    amount: Money;
    status: PaymentStatus;
    providerReference: string | null;
    redirectUrl: string | null;
    failureReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    this.id = params.id;
    this.merchantScope = params.merchantScope;
    this.idempotencyKey = params.idempotencyKey;
    this.providerName = params.providerName;
    this.amount = params.amount;
    this.status = params.status;
    this.providerReference = params.providerReference;
    this.redirectUrl = params.redirectUrl;
    this.failureReason = params.failureReason;
    this.createdAt = params.createdAt;
    this.updatedAt = params.updatedAt;
  }

  /** Creates a brand new payment in the initial `CREATED` state. */
  public static create(input: CreatePaymentInput): Payment {
    const now = new Date();

    return new Payment({
      id: PaymentId.generate(),
      merchantScope: input.merchantScope,
      idempotencyKey: input.idempotencyKey,
      providerName: input.providerName,
      amount: input.amount,
      status: PaymentStatus.CREATED,
      providerReference: null,
      redirectUrl: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Rehydrates a payment from persisted state. Does not re-validate transitions. */
  public static restore(input: RestorePaymentInput): Payment {
    return new Payment({ ...input });
  }

  public transitionTo(
    nextStatus: PaymentStatus,
    options?: {
      providerReference?: string | null;
      redirectUrl?: string | null;
      failureReason?: string | null;
    },
  ): void {
    if (!canTransition(this.status, nextStatus)) {
      throw new InvalidPaymentStateTransitionError(this.status, nextStatus);
    }

    this.status = nextStatus;
    this.updatedAt = new Date();

    if (options?.providerReference !== undefined) {
      this.providerReference = options.providerReference;
    }
    if (options?.redirectUrl !== undefined) {
      this.redirectUrl = options.redirectUrl;
    }
    if (options?.failureReason !== undefined) {
      this.failureReason = options.failureReason;
    }
  }

  public belongsToScope(scope: MerchantScope): boolean {
    return this.merchantScope.equals(scope);
  }

  public isTerminal(): boolean {
    return isTerminalStatus(this.status);
  }

  public getId(): PaymentId {
    return this.id;
  }

  public getMerchantScope(): MerchantScope {
    return this.merchantScope;
  }

  public getIdempotencyKey(): IdempotencyKey {
    return this.idempotencyKey;
  }

  public getProviderName(): string {
    return this.providerName;
  }

  public getAmount(): Money {
    return this.amount;
  }

  public getStatus(): PaymentStatus {
    return this.status;
  }

  public getProviderReference(): string | null {
    return this.providerReference;
  }

  public getRedirectUrl(): string | null {
    return this.redirectUrl;
  }

  public getFailureReason(): string | null {
    return this.failureReason;
  }

  public getCreatedAt(): Date {
    return this.createdAt;
  }

  public getUpdatedAt(): Date {
    return this.updatedAt;
  }

  public toSnapshot(): PaymentSnapshot {
    return {
      id: this.id.toString(),
      merchantScope: this.merchantScope.toString(),
      idempotencyKey: this.idempotencyKey.toString(),
      providerName: this.providerName,
      amountInMinorUnits: this.amount.getAmountInMinorUnits().toString(),
      currency: this.amount.getCurrency(),
      status: this.status,
      providerReference: this.providerReference,
      redirectUrl: this.redirectUrl,
      failureReason: this.failureReason,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}
