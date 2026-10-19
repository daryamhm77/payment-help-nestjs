# nestjs-payment-kit

Provider-agnostic payment orchestration toolkit for NestJS. Business logic talks to a single `PaymentProviderPort`; concrete adapters plug in through a typed registry.

## Status

| Capability | Mock | Stripe | Zarinpal |
| --- | --- | --- | --- |
| Create / verify / status / refund / webhooks | simulated | not implemented | not implemented |

The mock adapter never claims to settle real card or gateway payments. Enabling `stripe` or `zarinpal` without a real adapter fails closed with `ProviderNotRegisteredError`.

## Quick start

```typescript
import { Module } from '@nestjs/common';
import { PaymentKitModule, PAYMENT_PROVIDER_REGISTRY, PaymentProviderRegistry } from 'nestjs-payment-kit';

@Module({
  imports: [
    PaymentKitModule.forRoot({
      defaultProvider: 'mock',
      enabledProviders: ['mock'],
      idempotencyKeyTtlSeconds: 86_400,
    }),
  ],
})
export class AppModule {}
```

Resolve providers via the registry — never with hard-coded provider switches.

## Scripts

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
