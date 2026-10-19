import {
  canTransition,
  getAllowedTransitions,
  isTerminalStatus,
  PaymentStatus,
} from './payment-status';

describe('payment status transitions', () => {
  it('allows the canonical happy path: CREATED -> PROCESSING -> SUCCEEDED', () => {
    expect(canTransition(PaymentStatus.CREATED, PaymentStatus.PROCESSING)).toBe(true);
    expect(canTransition(PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED)).toBe(true);
  });

  it('allows the 3DS / redirect path: CREATED -> REQUIRES_ACTION -> PROCESSING -> SUCCEEDED', () => {
    expect(canTransition(PaymentStatus.CREATED, PaymentStatus.REQUIRES_ACTION)).toBe(true);
    expect(canTransition(PaymentStatus.REQUIRES_ACTION, PaymentStatus.PROCESSING)).toBe(true);
    expect(canTransition(PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED)).toBe(true);
  });

  it('allows a definitive failure from PROCESSING', () => {
    expect(canTransition(PaymentStatus.PROCESSING, PaymentStatus.FAILED)).toBe(true);
  });

  it('allows an unknown/ambiguous outcome from PROCESSING after a timeout', () => {
    expect(canTransition(PaymentStatus.PROCESSING, PaymentStatus.UNKNOWN)).toBe(true);
  });

  it('allows UNKNOWN to be resolved into SUCCEEDED or FAILED via reconciliation', () => {
    expect(canTransition(PaymentStatus.UNKNOWN, PaymentStatus.SUCCEEDED)).toBe(true);
    expect(canTransition(PaymentStatus.UNKNOWN, PaymentStatus.FAILED)).toBe(true);
  });

  it('allows UNKNOWN to remain UNKNOWN across repeated reconciliation attempts', () => {
    expect(canTransition(PaymentStatus.UNKNOWN, PaymentStatus.UNKNOWN)).toBe(true);
  });

  it('allows cancellation only before a provider call is submitted', () => {
    expect(canTransition(PaymentStatus.CREATED, PaymentStatus.CANCELED)).toBe(true);
    expect(canTransition(PaymentStatus.REQUIRES_ACTION, PaymentStatus.CANCELED)).toBe(true);
    expect(canTransition(PaymentStatus.PROCESSING, PaymentStatus.CANCELED)).toBe(false);
  });

  it('treats FAILED, CANCELED and REFUNDED as terminal (no outgoing transitions)', () => {
    for (const terminal of [
      PaymentStatus.FAILED,
      PaymentStatus.CANCELED,
      PaymentStatus.REFUNDED,
    ]) {
      expect(isTerminalStatus(terminal)).toBe(true);
      expect(getAllowedTransitions(terminal).size).toBe(0);
    }
  });

  it('allows SUCCEEDED to transition only to REFUNDED', () => {
    expect(isTerminalStatus(PaymentStatus.SUCCEEDED)).toBe(false);
    expect(canTransition(PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED)).toBe(true);
    expect(canTransition(PaymentStatus.SUCCEEDED, PaymentStatus.FAILED)).toBe(false);
  });

  it('never allows a terminal failure to silently become a success', () => {
    expect(canTransition(PaymentStatus.FAILED, PaymentStatus.SUCCEEDED)).toBe(false);
  });

  it('never allows UNKNOWN to be conflated with a definitive terminal state transition backwards', () => {
    expect(canTransition(PaymentStatus.SUCCEEDED, PaymentStatus.UNKNOWN)).toBe(false);
    expect(canTransition(PaymentStatus.FAILED, PaymentStatus.UNKNOWN)).toBe(false);
  });

  it('rejects skipping straight from CREATED to SUCCEEDED without going through PROCESSING', () => {
    expect(canTransition(PaymentStatus.CREATED, PaymentStatus.SUCCEEDED)).toBe(false);
  });

  it('allows REQUIRES_ACTION to become SUCCEEDED after provider verification', () => {
    expect(canTransition(PaymentStatus.REQUIRES_ACTION, PaymentStatus.SUCCEEDED)).toBe(true);
  });
});
