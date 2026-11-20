import { KeyFetchError } from '#/services/verification-error';

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 1_048_576;

// Reads at most `MAX_BYTES` of a body, counting bytes as they arrive and
// hanging up on the first chunk that passes the cap.
async function readCapped(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('declared too large a document');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  // Leaving the loop early cancels the stream, which hangs up on the server.
  for await (const piece of response.body ?? []) {
    const chunk: unknown = piece;
    if (!(chunk instanceof Uint8Array)) throw new Error('answered with a body of no bytes');
    total += chunk.byteLength;
    if (total > MAX_BYTES) throw new Error('answered with too large a document');
    chunks.push(chunk);
  }
  return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}

async function getJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`answered ${String(response.status)}`);
    return JSON.parse(await readCapped(response));
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
