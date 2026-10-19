import { DelayFn } from './mock-delay';
import { MockScenario } from './mock-scenarios';

/**
 * Configuration for {@link MockPaymentProviderAdapter}. Safe to import from
 * infrastructure config without pulling in the adapter implementation.
 */
export interface MockPaymentProviderOptions {
  /**
   * Deterministic scenario applied when a request does not override it via
   * metadata. Defaults to `'success'`.
   */
  readonly defaultScenario?: MockScenario;

  /**
   * Wall-clock wait used by the `'delayed'` scenario. Ignored when
   * {@link delay} is a no-op (as in unit tests).
   */
  readonly delayMs?: number;

  /**
   * Delay implementation. Defaults to a no-op unless the scenario is
   * `'delayed'`; tests should inject {@link noDelay} or a recording fake.
   */
  readonly delay?: DelayFn;
}
