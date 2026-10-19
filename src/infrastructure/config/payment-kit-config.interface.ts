import { MockPaymentProviderOptions } from '../../adapters/mock/mock-payment-provider.options';

/**
 * Supported payment provider identifiers. Kept as a const union (not a
 * TypeScript `enum`) so it stays a plain string at runtime, which keeps
 * config objects JSON-serializable and easy to validate.
 */
export const SUPPORTED_PROVIDERS = ['mock', 'stripe', 'zarinpal'] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

/**
 * Strongly-typed configuration consumed by the NestJS module.
 *
 * Provider-specific credentials (Stripe secret key, Zarinpal merchant id, ...)
 * are intentionally omitted until those adapters ship — enabling `stripe` or
 * `zarinpal` today will fail at resolve-time with
 * {@link ProviderNotRegisteredError} because no adapter is registered yet.
 */
export interface PaymentKitConfig {
  readonly defaultProvider: SupportedProvider;
  /**
   * Providers that may be selected at runtime. Disabled providers cannot be
   * resolved even if an adapter instance exists.
   */
  readonly enabledProviders: readonly SupportedProvider[];
  readonly idempotencyKeyTtlSeconds: number;
  /** Options forwarded to {@link MockPaymentProviderAdapter} when mock is enabled. */
  readonly mock?: MockPaymentProviderOptions;
}

export const PAYMENT_KIT_CONFIG = Symbol('PAYMENT_KIT_CONFIG');

export const DEFAULT_PAYMENT_KIT_CONFIG: PaymentKitConfig = {
  defaultProvider: 'mock',
  enabledProviders: ['mock'],
  idempotencyKeyTtlSeconds: 86_400,
};
