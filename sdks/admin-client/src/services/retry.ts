export const MAX_RETRIES = 2;
const BASE_DELAY_MS = 200;
const MAX_DELAY_MS = 5000;
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'];

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** A repeat is harmless for the methods HTTP defines as idempotent and for a call that carries a key. */
export function mayRetry(method: string, headers: Headers): boolean {
  return SAFE_METHODS.includes(method.toUpperCase()) || headers.has('Idempotency-Key');
}

/** Waits `Retry-After` seconds when the server names them, otherwise doubles from 200 ms; never over 5 s. */
export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  const wanted = Number.isFinite(seconds) ? seconds * 1000 : BASE_DELAY_MS * 2 ** attempt;
  return Math.min(Math.max(wanted, 0), MAX_DELAY_MS);
}
