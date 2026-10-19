# nestjs-payment-kit

Provider-agnostic payment orchestration toolkit for NestJS. Business logic talks to `PaymentProviderPort` and orchestration use cases; concrete adapters (mock today, Stripe and Iranian gateways next) plug in through a typed registry.

## Status

| Layer | Status |
| --- | --- |
| Domain payment entity + status machine | ✅ |
| Provider port + mock adapter | ✅ |
| Orchestration use cases (create / verify / status / refund) | ✅ |
| Durable idempotency **port** (DB-oriented) | ✅ |
| Postgres / other durable persistence adapters | ❌ awaiting host implementation |
| Stripe / Zarinpal adapters | ❌ not implemented |

| Provider capability | Mock | Stripe | Zarinpal |
| --- | --- | --- | --- |
| Create / verify / status / refund / webhooks | ✅ simulated | ❌ | ❌ |

The mock adapter **never** claims to settle real card or gateway payments. In-memory repository and idempotency store are **test/dev doubles only** — production must supply durable implementations of `PaymentRepositoryPort` and `IdempotencyStorePort`.

## Safety invariants

- Money uses integer minor units (`Money` / `bigint`) — no floating-point arithmetic.
- Idempotency is keyed by `(merchantScope, key, operationType)` with request fingerprinting; same key + different payload → `IdempotencyKeyConflictError`.
- Provider HTTP calls are **never** assumed to share a DB transaction with local writes.
- After a provider timeout, the payment becomes `UNKNOWN`; retries **reconcile** (or re-call create only when the provider supports idempotency keys) — they do **not** create a second logical payment.
- A browser redirect alone never marks `SUCCEEDED`; `VerifyPaymentUseCase` requires a provider reference and a provider verify call.
- Duplicate verify of an already-`SUCCEEDED` payment is a no-op.

## Install

```bash
pnpm add nestjs-payment-kit
# peer: @nestjs/common, reflect-metadata, rxjs
```

## Quick start

```typescript
import { Module } from '@nestjs/common';
import {
  PaymentKitModule,
  CREATE_PAYMENT_USE_CASE,
  CreatePaymentUseCase,
} from 'nestjs-payment-kit';
// import { PostgresPaymentRepository, PostgresIdempotencyStore } from './persistence';

@Module({
  imports: [
    PaymentKitModule.forRoot({
      defaultProvider: 'mock',
      enabledProviders: ['mock'],
      idempotencyKeyTtlSeconds: 86_400,
      // Required for use cases — supply durable DB adapters in production:
      // persistence: {
      //   paymentRepository: PostgresPaymentRepository,
      //   idempotencyStore: PostgresIdempotencyStore,
      // },
    }),
  ],
})
export class AppModule {}
```

```typescript
constructor(
  @Inject(CREATE_PAYMENT_USE_CASE) private readonly createPayment: CreatePaymentUseCase,
) {}

await this.createPayment.execute({
  merchantScope: 'merchant_42',
  idempotencyKey: 'order_1001_create',
  amountInMinorUnits: 10_000,
  currency: 'IRR',
});
```

Without `persistence`, the module still registers the provider registry (useful for adapter-only wiring). Use cases require persistence providers.

## Idempotency port (durable)

`IdempotencyStorePort.begin / attachPayment / complete` is designed for a relational unique constraint, e.g.:

```sql
PRIMARY KEY (merchant_scope, idempotency_key, operation_type)
```

Do **not** rely on Redis TTL or a process-local `Map` in production. The shipped `InMemoryIdempotencyStore` only simulates row locking for tests.

## Persistence still awaiting implementation

1. **Postgres (or other SQL) `PaymentRepositoryPort`** — including unique `(merchant_scope, idempotency_key)` and optimistic concurrency / versioning if desired.
2. **Postgres `IdempotencyStorePort`** — `INSERT … ON CONFLICT` for `begin`, transactional `attach` / `complete`.
3. **Outbox / webhook consumer** wiring for async provider events (port exists on providers; orchestration consumer not shipped).
4. **Stripe and Zarinpal adapters** — enabling them today fails closed with `ProviderNotRegisteredError`.

## Mock scenarios

| Scenario | Behavior |
| --- | --- |
| `success` | Create succeeds |
| `declined` | Create returns definitive `failed` |
| `timeout` / `unknown` | Throws `ProviderUnknownOutcomeError` → local `UNKNOWN` |
| `delayed` | Injectable delay, then success |
| `duplicate_webhook` | Webhooks report `isDuplicate: true` |
| `refund_success` / `refund_failure` | Refund outcomes |

## Scripts

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Architecture

- `domain/` — `Payment`, `MerchantScope`, money/id VOs, status machine, errors
- `application/` — ports, registry, fingerprinting, use cases
- `adapters/` — mock provider; in-memory persistence **doubles**
- `infrastructure/` — config validation, `PaymentKitModule`
# payment-help-nestjs
