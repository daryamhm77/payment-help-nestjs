/**
 * Base class for every error raised by this library. Carries a stable machine
 * readable `code` so that consuming applications can branch on error type
 * without relying on `instanceof` across package boundaries (e.g. when the
 * error crosses a process/serialization boundary).
 */
export abstract class PaymentKitError extends Error {
  public abstract readonly code: string;

  protected constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
