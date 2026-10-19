import {
  FULL_PROVIDER_CAPABILITIES,
  ProviderCapabilities,
} from '../../application/dto/provider-capabilities.dto';
import {
  CreatePaymentRequest,
  CreatePaymentResult,
  GetPaymentStatusRequest,
  PaymentStatusResult,
} from '../../application/dto/provider-charge.dto';
import { RefundPaymentRequest, RefundPaymentResult } from '../../application/dto/provider-refund.dto';
import { VerifyPaymentRequest, VerifyPaymentResult } from '../../application/dto/provider-verify.dto';
import {
  NormalizedWebhookEvent,
  ParseWebhookRequest,
} from '../../application/dto/provider-webhook.dto';
import { PaymentProviderPort } from '../../application/ports/payment-provider.port';
import {
  ProviderDefinitiveFailureError,
  ProviderUnknownOutcomeError,
} from '../../domain/errors/payment-provider-errors';

import { DelayFn, noDelay, realDelay } from './mock-delay';
import { MockPaymentProviderOptions } from './mock-payment-provider.options';
import {
  isMockScenario,
  MOCK_SCENARIO_METADATA_KEY,
  MockScenario,
} from './mock-scenarios';

export type { MockPaymentProviderOptions } from './mock-payment-provider.options';

const PROVIDER_NAME = 'mock';
const REFERENCE_PREFIX = 'mock_ref_';
const REFUND_PREFIX = 'mock_refund_';
const DEFAULT_DELAY_MS = 25;

interface StoredCharge {
  readonly outcome: 'succeeded' | 'failed' | 'redirect_required' | 'processing';
  readonly amountMinor: string;
  readonly currency: string;
  readonly paymentId: string;
}

interface MockWebhookPayload {
  readonly eventId: string;
  readonly type: NormalizedWebhookEvent['type'];
  readonly providerReference: string | null;
  readonly refundReference: string | null;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * In-memory payment provider adapter with no external dependencies. Useful
 * for local development, integration tests, and as a reference
 * implementation of {@link PaymentProviderPort}.
 *
 * Important: this adapter only verifies / refunds references it itself
 * created (`mock_ref_*`). Foreign references fail closed — it never silently
 * claims to settle a real upstream payment.
 */
export class MockPaymentProviderAdapter implements PaymentProviderPort {
  public readonly name = PROVIDER_NAME;

  private readonly defaultScenario: MockScenario;
  private readonly delayMs: number;
  private readonly delay: DelayFn;
  private readonly charges = new Map<string, StoredCharge>();
  /** Provider-side idempotency: same key returns the original reference. */
  private readonly chargesByIdempotencyKey = new Map<string, CreatePaymentResult>();
  private readonly seenWebhookEventIds = new Set<string>();
  private createCallCount = 0;

  public constructor(options: MockPaymentProviderOptions = {}) {
    this.defaultScenario = options.defaultScenario ?? 'success';
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
    this.delay = options.delay ?? (options.defaultScenario === 'delayed' ? realDelay : noDelay);
  }

  public getCapabilities(): ProviderCapabilities {
    return FULL_PROVIDER_CAPABILITIES;
  }

  /** Test helper: how many times createPayment was invoked. */
  public getCreateCallCount(): number {
    return this.createCallCount;
  }

  public async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResult> {
    this.createCallCount += 1;

    if (request.idempotencyKey !== undefined) {
      const existing = this.chargesByIdempotencyKey.get(request.idempotencyKey);
      if (existing !== undefined) {
        return existing;
      }
    }

    const scenario = this.resolveScenario(request.metadata);

    if (scenario === 'delayed') {
      await this.delay(this.delayMs);
    }

    if (scenario === 'timeout' || scenario === 'unknown') {
      throw new ProviderUnknownOutcomeError(
        PROVIDER_NAME,
        scenario === 'timeout'
          ? `Mock provider timed out before confirming charge for payment ${request.paymentId.toString()}`
          : `Mock provider could not confirm charge outcome for payment ${request.paymentId.toString()}`,
      );
    }

    const providerReference = `${REFERENCE_PREFIX}${request.paymentId.toString()}`;

    if (scenario === 'declined') {
      this.charges.set(providerReference, {
        outcome: 'failed',
        amountMinor: request.amount.getAmountInMinorUnits().toString(),
        currency: request.amount.getCurrency(),
        paymentId: request.paymentId.toString(),
      });

      const failed: CreatePaymentResult = {
        outcome: 'failed',
        providerReference,
        reason: 'mock_decline',
      };
      this.rememberIdempotentCreate(request.idempotencyKey, failed);
      return failed;
    }

    // success | duplicate_webhook | refund_* | delayed (after wait) → succeeded
    this.charges.set(providerReference, {
      outcome: 'succeeded',
      amountMinor: request.amount.getAmountInMinorUnits().toString(),
      currency: request.amount.getCurrency(),
      paymentId: request.paymentId.toString(),
    });

    const succeeded: CreatePaymentResult = { outcome: 'succeeded', providerReference };
    this.rememberIdempotentCreate(request.idempotencyKey, succeeded);
    return succeeded;
  }

  private rememberIdempotentCreate(
    idempotencyKey: string | undefined,
    result: CreatePaymentResult,
  ): void {
    if (idempotencyKey !== undefined) {
      this.chargesByIdempotencyKey.set(idempotencyKey, result);
    }
  }

  public verifyPayment(request: VerifyPaymentRequest): Promise<VerifyPaymentResult> {
    if (!this.isOwnReference(request.providerReference)) {
      return Promise.reject(
        new ProviderDefinitiveFailureError(
          PROVIDER_NAME,
          `Refusing to verify foreign provider reference "${request.providerReference}" — mock never settles real payments`,
          { providerErrorCode: 'foreign_reference' },
        ),
      );
    }

    const scenario = this.resolveScenario(request.metadata);

    if (scenario === 'timeout' || scenario === 'unknown') {
      return Promise.reject(
        new ProviderUnknownOutcomeError(
          PROVIDER_NAME,
          `Mock provider could not confirm verify outcome for ${request.providerReference}`,
        ),
      );
    }

    const stored = this.charges.get(request.providerReference);

    if (stored === undefined) {
      return Promise.resolve({
        outcome: 'failed',
        providerReference: request.providerReference,
        reason: 'unknown_reference',
      });
    }

    if (stored.outcome === 'failed') {
      return Promise.resolve({
        outcome: 'failed',
        providerReference: request.providerReference,
        reason: 'mock_decline',
      });
    }

    if (
      stored.amountMinor !== request.amount.getAmountInMinorUnits().toString() ||
      stored.currency !== request.amount.getCurrency()
    ) {
      return Promise.resolve({
        outcome: 'failed',
        providerReference: request.providerReference,
        reason: 'amount_mismatch',
      });
    }

    return Promise.resolve({
      outcome: 'succeeded',
      providerReference: request.providerReference,
    });
  }

  public getPaymentStatus(request: GetPaymentStatusRequest): Promise<PaymentStatusResult> {
    if (request.providerReference === null) {
      return Promise.resolve({ outcome: 'unknown' });
    }

    if (!this.isOwnReference(request.providerReference)) {
      return Promise.resolve({ outcome: 'unknown' });
    }

    const stored = this.charges.get(request.providerReference);

    if (stored === undefined) {
      return Promise.resolve({ outcome: 'unknown' });
    }

    if (stored.outcome === 'succeeded') {
      return Promise.resolve({
        outcome: 'succeeded',
        providerReference: request.providerReference,
      });
    }

    if (stored.outcome === 'failed') {
      return Promise.resolve({
        outcome: 'failed',
        providerReference: request.providerReference,
        reason: 'mock_decline',
      });
    }

    return Promise.resolve({ outcome: 'processing' });
  }

  public refundPayment(request: RefundPaymentRequest): Promise<RefundPaymentResult> {
    if (!this.isOwnReference(request.providerReference)) {
      return Promise.reject(
        new ProviderDefinitiveFailureError(
          PROVIDER_NAME,
          `Refusing to refund foreign provider reference "${request.providerReference}"`,
          { providerErrorCode: 'foreign_reference' },
        ),
      );
    }

    const scenario = this.resolveScenario(request.metadata, 'refund');

    if (scenario === 'timeout' || scenario === 'unknown') {
      return Promise.reject(
        new ProviderUnknownOutcomeError(
          PROVIDER_NAME,
          `Mock provider could not confirm refund outcome for ${request.providerReference}`,
        ),
      );
    }

    const stored = this.charges.get(request.providerReference);

    if (stored === undefined || stored.outcome !== 'succeeded') {
      return Promise.resolve({
        outcome: 'failed',
        providerReference: request.providerReference,
        reason: 'not_refundable',
      });
    }

    if (scenario === 'refund_failure' || scenario === 'declined') {
      return Promise.resolve({
        outcome: 'failed',
        providerReference: request.providerReference,
        reason: 'mock_refund_declined',
      });
    }

    return Promise.resolve({
      outcome: 'succeeded',
      refundReference: `${REFUND_PREFIX}${request.paymentId.toString()}`,
      providerReference: request.providerReference,
    });
  }

  public parseWebhookEvent(request: ParseWebhookRequest): Promise<NormalizedWebhookEvent> {
    try {
      const payload = this.parsePayload(request.rawBody);
      const alreadySeen = this.seenWebhookEventIds.has(payload.eventId);
      const forceDuplicate =
        this.defaultScenario === 'duplicate_webhook' ||
        payload.metadata?.[MOCK_SCENARIO_METADATA_KEY] === 'duplicate_webhook';

      // Under the duplicate_webhook scenario the first delivery is already flagged
      // so host apps can exercise idempotent handlers in a single call.
      const isDuplicate = alreadySeen || Boolean(forceDuplicate);
      this.seenWebhookEventIds.add(payload.eventId);

      return Promise.resolve({
        eventId: payload.eventId,
        type: payload.type,
        providerReference: payload.providerReference,
        refundReference: payload.refundReference,
        isDuplicate,
        occurredAt: new Date(0),
        metadata: payload.metadata ?? {},
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Test helper: seeds a charge the same way {@link createPayment} would, so
   * contract tests can exercise verify/refund/status without re-creating.
   */
  public seedSucceededCharge(params: {
    paymentId: string;
    providerReference: string;
    amountMinor: string;
    currency: string;
  }): void {
    this.charges.set(params.providerReference, {
      outcome: 'succeeded',
      amountMinor: params.amountMinor,
      currency: params.currency,
      paymentId: params.paymentId,
    });
  }

  private resolveScenario(
    metadata: Readonly<Record<string, string>> | undefined,
    mode: 'create' | 'refund' = 'create',
  ): MockScenario {
    const fromMetadata = metadata?.[MOCK_SCENARIO_METADATA_KEY];

    if (fromMetadata !== undefined && isMockScenario(fromMetadata)) {
      return fromMetadata;
    }

    if (mode === 'refund') {
      if (this.defaultScenario === 'refund_failure') {
        return 'refund_failure';
      }
      if (this.defaultScenario === 'refund_success') {
        return 'refund_success';
      }
    }

    return this.defaultScenario;
  }

  private isOwnReference(providerReference: string): boolean {
    return providerReference.startsWith(REFERENCE_PREFIX);
  }

  private parsePayload(rawBody: string | Buffer): MockWebhookPayload {
    const text = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

    let parsed: unknown;

    try {
      parsed = JSON.parse(text) as unknown;
    } catch (cause) {
      throw new ProviderDefinitiveFailureError(PROVIDER_NAME, 'Mock webhook payload is not valid JSON', {
        providerErrorCode: 'invalid_json',
        cause,
      });
    }

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ProviderDefinitiveFailureError(PROVIDER_NAME, 'Mock webhook payload must be a JSON object', {
        providerErrorCode: 'invalid_payload',
      });
    }

    const record = parsed as Record<string, unknown>;
    const eventId = record['eventId'];
    const type = record['type'];

    if (typeof eventId !== 'string' || eventId.length === 0) {
      throw new ProviderDefinitiveFailureError(PROVIDER_NAME, 'Mock webhook payload missing eventId', {
        providerErrorCode: 'missing_event_id',
      });
    }

    if (typeof type !== 'string') {
      throw new ProviderDefinitiveFailureError(PROVIDER_NAME, 'Mock webhook payload missing type', {
        providerErrorCode: 'missing_type',
      });
    }

    return {
      eventId,
      type: type as NormalizedWebhookEvent['type'],
      providerReference: typeof record['providerReference'] === 'string' ? record['providerReference'] : null,
      refundReference: typeof record['refundReference'] === 'string' ? record['refundReference'] : null,
      ...(typeof record['metadata'] === 'object' &&
      record['metadata'] !== null &&
      !Array.isArray(record['metadata'])
        ? {
            metadata: record['metadata'] as Readonly<Record<string, string>>,
          }
        : {}),
    };
  }
}
