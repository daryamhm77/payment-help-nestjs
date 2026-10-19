/**
 * Deterministic mock scenarios for local development and automated tests.
 * Each scenario maps to a fixed adapter behavior — never random.
 */
export const MOCK_SCENARIOS = [
  'success',
  'declined',
  'timeout',
  'unknown',
  'duplicate_webhook',
  'delayed',
  'refund_success',
  'refund_failure',
] as const;

export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export function isMockScenario(value: string): value is MockScenario {
  return (MOCK_SCENARIOS as readonly string[]).includes(value);
}

/** Metadata key host apps may set on create/verify/refund requests to override the default scenario. */
export const MOCK_SCENARIO_METADATA_KEY = 'mockScenario';
