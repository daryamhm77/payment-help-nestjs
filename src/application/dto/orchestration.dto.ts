import { PaymentStatus } from '../../domain/payment-status';
import { PaymentSnapshot } from '../../domain/payment.entity';

export interface CreatePaymentCommand {
  readonly merchantScope: string;
  readonly idempotencyKey: string;
  readonly amountInMinorUnits: number | bigint;
  readonly currency: string;
  /** When omitted, the registry default provider is used. */
  readonly providerName?: string;
  readonly returnUrl?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface VerifyPaymentCommand {
  readonly merchantScope: string;
  readonly paymentId: string;
  /**
   * Optional caller idempotency key for the verify operation. Defaults to a
   * stable key derived from the payment id so duplicate verifies are safe.
   */
  readonly idempotencyKey?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface GetPaymentStatusCommand {
  readonly merchantScope: string;
  readonly paymentId: string;
  /**
   * When true (default for UNKNOWN/PROCESSING), query the provider to
   * reconcile. Never invents success from a browser redirect.
   */
  readonly reconcile?: boolean;
}

export interface RefundPaymentCommand {
  readonly merchantScope: string;
  readonly paymentId: string;
  readonly idempotencyKey: string;
  /** Defaults to the full original amount when omitted. */
  readonly amountInMinorUnits?: number | bigint;
  readonly currency?: string;
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface PaymentOperationResult {
  readonly payment: PaymentSnapshot;
  /** True when this call reused an existing idempotent outcome. */
  readonly replayed: boolean;
  readonly status: PaymentStatus;
}
