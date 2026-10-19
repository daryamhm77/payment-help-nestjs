import {
  InvalidProviderSelectionError,
  ProviderDisabledError,
  ProviderNotRegisteredError,
} from '../../domain/errors/payment-provider-errors';
import { PaymentProviderPort } from '../ports/payment-provider.port';

/**
 * Minimal selection config consumed by the registry. Kept free of NestJS and
 * env-parsing details so the application layer does not depend on infrastructure.
 */
export interface ProviderSelectionConfig {
  readonly defaultProvider: string;
  readonly enabledProviders: readonly string[];
}

/**
 * Typed, name-keyed registry of payment provider adapters. Application
 * services resolve providers through this registry instead of branching on
 * provider names with `if`/`else` or `switch`.
 *
 * Selection rules (fail-closed):
 * 1. Name must appear in `config.enabledProviders`.
 * 2. Name must have a registered adapter instance.
 * 3. When no name is supplied, `config.defaultProvider` is used (and must
 *    itself satisfy rules 1–2).
 */
export class PaymentProviderRegistry {
  private readonly providers = new Map<string, PaymentProviderPort>();
  private readonly enabled: ReadonlySet<string>;
  private readonly defaultProvider: string;

  public constructor(config: ProviderSelectionConfig, providers: readonly PaymentProviderPort[]) {
    this.enabled = new Set(config.enabledProviders);
    this.defaultProvider = config.defaultProvider;

    if (!this.enabled.has(config.defaultProvider)) {
      throw new InvalidProviderSelectionError(
        `Default provider "${config.defaultProvider}" is not listed in enabledProviders`,
      );
    }

    for (const provider of providers) {
      if (this.providers.has(provider.name)) {
        throw new InvalidProviderSelectionError(
          `Duplicate payment provider registration for key "${provider.name}"`,
        );
      }
      this.providers.set(provider.name, provider);
    }
  }

  /** Returns whether an adapter instance is registered for `name`. */
  public has(name: string): boolean {
    return this.providers.has(name);
  }

  /** Returns whether `name` is allowed by configuration. */
  public isEnabled(name: string): boolean {
    return this.enabled.has(name);
  }

  /** Lists registered provider names (not necessarily enabled). */
  public listRegistered(): readonly string[] {
    return [...this.providers.keys()];
  }

  /** Lists providers that are both registered and enabled. */
  public listSelectable(): readonly string[] {
    return this.listRegistered().filter((name) => this.enabled.has(name));
  }

  /**
   * Resolves a provider by name (or the configured default). Throws
   * {@link ProviderDisabledError} or {@link ProviderNotRegisteredError} —
   * never returns a disabled/missing adapter.
   */
  public resolve(providerName?: string): PaymentProviderPort {
    const name = providerName ?? this.defaultProvider;

    if (!this.enabled.has(name)) {
      throw new ProviderDisabledError(name);
    }

    const provider = this.providers.get(name);

    if (provider === undefined) {
      throw new ProviderNotRegisteredError(name);
    }

    return provider;
  }
}
