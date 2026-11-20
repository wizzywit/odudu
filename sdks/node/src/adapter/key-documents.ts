import { KeyFetchError } from '#/services/verification-error';

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 1_048_576;

async function getJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`answered ${String(response.status)}`);
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error('answered with too large a document');
    return JSON.parse(text);
  } catch (cause) {
    throw new KeyFetchError(`could not read ${url}`, { cause });
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// The `jwks_uri` of a configured issuer's discovery document. The document must
// name that issuer (OpenID Connect Discovery §4.3); a document that names
// another one is not that issuer's.
export async function readJwksUri(issuer: string, fetcher: typeof fetch): Promise<string> {
  const document = await getJson(`${issuer}/.well-known/openid-configuration`, fetcher);
  if (!isRecord(document) || document.issuer !== issuer || typeof document.jwks_uri !== 'string') {
    throw new KeyFetchError(`the discovery document of ${issuer} names no jwks_uri of its own`);
  }
  return document.jwks_uri;
}

export const readKeyDocument = (jwksUri: string, fetcher: typeof fetch): Promise<unknown> =>
  getJson(jwksUri, fetcher);
