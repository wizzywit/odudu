import { createHash } from 'node:crypto';
import { canonicalize } from '#/service/etag';

export const IDEMPOTENCY_WINDOW_SECONDS = 24 * 60 * 60;
export const IDEMPOTENCY_MAX_LIVE_KEYS = 10_000;
export const IDEMPOTENCY_MAX_BODY_BYTES = 64 * 1024;

const KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,255}$/u;

function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * SHA-256 of the canonical JSON of the method, the path and the body, so two
 * requests with the same members in another order are the same request. A raw
 * body stands for its bytes; an absent one is `null`, which no JSON body is
 * once it is wrapped as it is here.
 */
export function fingerprintOf(method: string, path: string, body: unknown): string {
  const stood = Buffer.isBuffer(body) ? { raw_sha256: sha256(body) } : body;
  return sha256(
    JSON.stringify(canonicalize({ method, path, body: stood === undefined ? null : [stood] })),
  );
}

export interface FingerprintCaller {
  readonly subjectId: string;
  readonly issuerTenantId: string;
  readonly agentClientId?: string | undefined;
}

/**
 * The fingerprint a row stores: the request's, bound to who made it. A key
 * replays only to the caller that first used it, so a second administrator
 * (or an agent acting for the first) presenting it is answered as a key
 * reused for a different request, never with the first caller's response.
 */
export function principalFingerprint(caller: FingerprintCaller, fingerprint: string): string {
  return sha256(
    JSON.stringify([
      caller.issuerTenantId,
      caller.subjectId,
      caller.agentClientId ?? null,
      fingerprint,
    ]),
  );
}

export type IdempotencyKeyHeader =
  | { readonly kind: 'absent' }
  | { readonly kind: 'valid'; readonly key: string }
  | { readonly kind: 'invalid' };

export function idempotencyKeyOf(
  header: string | readonly string[] | undefined,
): IdempotencyKeyHeader {
  if (header === undefined) return { kind: 'absent' };
  if (typeof header !== 'string' || !KEY_PATTERN.test(header)) return { kind: 'invalid' };
  return { kind: 'valid', key: header };
}

/**
 * Only a POST carries the key: a PUT, a PATCH and a DELETE are idempotent by
 * their method's definition, so repeating one lands where the first did.
 */
export function idempotentMethod(method: string): boolean {
  return method === 'POST';
}

export type ResponseVerdict = 'store' | 'skip' | 'too_large';

/**
 * A success is kept; a refusal or a failure is not, since the request did not
 * do what it asked and a retry must be free to. A body over the cap is
 * neither: it cannot be replayed, so the call that made it is undone, unless
 * the call ran outside the transaction and cannot be, when nothing is kept.
 */
export function responseVerdict(
  status: number,
  body: string,
  withinTransaction = true,
): ResponseVerdict {
  if (status < 200 || status > 299 || !withinTransaction) return 'skip';
  return Buffer.byteLength(body, 'utf8') > IDEMPOTENCY_MAX_BODY_BYTES ? 'too_large' : 'store';
}

/** Whether a stored row answers this request, or its key was used for another. */
export function requestMatches(storedFingerprint: string, fingerprint: string): boolean {
  return storedFingerprint === fingerprint;
}

export function atCapacity(liveKeys: number): boolean {
  return liveKeys >= IDEMPOTENCY_MAX_LIVE_KEYS;
}

const REPLAYED = ['content-type', 'etag', 'location', 'retry-after'] as const;

/** The response headers a replay repeats: the ones a client reads from it. */
export function replayedHeaders(headers: Record<string, unknown>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of REPLAYED) {
    const value = headers[name];
    if (typeof value === 'string') kept[name] = value;
  }
  return kept;
}
