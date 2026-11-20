import type { JWK } from 'jose';
import { readJwksUri, readKeyDocument } from '#/adapter/key-documents';
import { keysByKid } from '#/services/jwks';
import { type Entry, mayRefetch, REFETCH_INTERVAL_MS, TimedCache } from '#/services/key-cache';
import { KeyFetchError } from '#/services/verification-error';

interface KeySet {
  keys: Map<string, JWK>;
}

export interface KeyStoreDeps {
  ttlMs: number;
  now: () => number;
  fetch: typeof fetch;
}

// Reads an issuer's keys through its discovery document and keeps them. The
// issuer comes from the caller's configured list, never from a token, and the
// key URL from the issuer's own document.
export function createKeyStore(deps: KeyStoreDeps): {
  keyFor: (issuer: string, kid: string) => Promise<JWK | undefined>;
} {
  const discovery = new TimedCache<string>();
  const sets = new TimedCache<KeySet>();

  function jwksUri(issuer: string): Promise<string> {
    const now = deps.now();
    const held = discovery.get(issuer, now);
    if (held !== undefined) return held.value;
    const request = readJwksUri(issuer, deps.fetch);
    const entry = discovery.set(issuer, request, now, deps.ttlMs);
    request.catch(() => {
      discovery.retire(entry, now + REFETCH_INTERVAL_MS);
    });
    return request;
  }

  async function readKeys(issuer: string): Promise<KeySet> {
    const document = await readKeyDocument(await jwksUri(issuer), deps.fetch);
    const keys = keysByKid(document);
    if (keys === undefined) throw new KeyFetchError(`the key set of ${issuer} is not a JWK Set`);
    return { keys };
  }

  function fetchSet(issuer: string): Entry<KeySet> {
    const now = deps.now();
    const request = readKeys(issuer);
    const entry = sets.set(issuer, request, now, deps.ttlMs);
    request.catch(() => {
      sets.retire(entry, now + REFETCH_INTERVAL_MS);
    });
    return entry;
  }

  async function keyFor(issuer: string, kid: string): Promise<JWK | undefined> {
    const entry = sets.get(issuer, deps.now()) ?? fetchSet(issuer);
    const found = (await entry.value).keys.get(kid);
    if (found !== undefined) return found;
    const latest = sets.get(issuer, deps.now()) ?? entry;
    if (latest !== entry) return (await latest.value).keys.get(kid);
    if (!mayRefetch(entry.startedAt, deps.now())) return undefined;
    return (await fetchSet(issuer).value).keys.get(kid);
  }

  return { keyFor };
}
