/**
 * Injectable delay primitive so the mock provider can simulate latency without
 * forcing real wall-clock sleeps in unit tests.
 */
export type DelayFn = (ms: number) => Promise<void>;

/** Production-style delay using the real event loop timer. */
export const realDelay: DelayFn = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Deterministic no-op delay for tests and fast local scenarios. */
export const noDelay: DelayFn = (_ms: number): Promise<void> => Promise.resolve();

/**
 * Records delay requests without sleeping. Useful in tests that assert the
 * mock asked to wait, without depending on fake timers.
 */
export function createRecordingDelay(): {
  readonly calls: number[];
  readonly delay: DelayFn;
} {
  const calls: number[] = [];

  return {
    calls,
    delay: (ms: number): Promise<void> => {
      calls.push(ms);
      return Promise.resolve();
    },
  };
}
