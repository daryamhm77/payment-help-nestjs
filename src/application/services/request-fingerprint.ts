import { createHash } from 'node:crypto';

import { RequestFingerprint } from '../ports/idempotency-store.port';

/**
 * Builds a stable fingerprint over the financially meaningful fields of a
 * request. Same logical payload → same fingerprint; any material change
 * (amount, currency, provider, scope, …) → conflict on replay.
 */
export function fingerprintPayload(parts: Readonly<Record<string, string>>): RequestFingerprint {
  const canonical = Object.keys(parts)
    .sort()
    .map((key) => `${key}=${parts[key] ?? ''}`)
    .join('&');

  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
