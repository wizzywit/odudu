import { isIP } from 'node:net';
import { isLoopbackHost } from '@odudu/kernel';
import { privateMemberRefusal } from '#/service/client-metadata';
export { isCimdRedirectUri } from '#/service/redirect-uri';

export type CimdRefusal =
  | 'not_an_object'
  | 'client_id_mismatch'
  | 'client_name_missing'
  | 'redirect_uris_invalid'
  | 'redirect_uri_refused'
  | 'client_secret_present'
  | 'auth_method_refused'
  | 'jwks_invalid'
  | 'jwks_private';

export interface CimdClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: 'none' | 'private_key_jwt';
  jwks: { keys: unknown[] } | null;
  jwksUri: string | null;
  // At least one redirect URI is a loopback address: the client is a native
  // app, and a person's consent names a program on their own machine.
  loopback: boolean;
}

export type CimdOutcome =
  { kind: 'ok'; client: CimdClient } | { kind: 'invalid'; reason: CimdRefusal };

const NAME_MAX = 200;

const CLIENT_ID_MAX = 2048;
const REDIRECT_URIS_MAX = 20;
const LOOPBACK_HTTP = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?=[:/?]|$)/;

// A client_id that is a URL a document can be fetched from: https, a path
// beyond the root, no fragment, no credentials, and already in the form a
// URL parser would write it, so the string fetched is the string compared.
export function isCimdClientId(raw: string): boolean {
  if (raw.length > CLIENT_ID_MAX || /[^\u0021-\u007e]|\\/.test(raw) || raw.includes('#')) {
    return false;
  }
  if (!URL.canParse(raw)) return false;
  const url = new URL(raw);
  if (url.href !== raw || raw.endsWith('?')) return false;
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
  if (url.pathname === '/' || url.hostname.endsWith('.')) return false;
  if (url.hostname.startsWith('[') || isIP(url.hostname) !== 0) return false;
  return !url.pathname.split('/').some((s) => s === '.' || s === '..');
}

function isAllowedRedirectUri(raw: string): boolean {
  if (/[^\u0021-\u007e]|\\/.test(raw) || !URL.canParse(raw)) return false;
  const url = new URL(raw);
  if (url.hash !== '' || raw.includes('#') || url.username !== '' || url.password !== '') {
    return false;
  }
  if (url.hostname.includes('*')) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOOPBACK_HTTP.test(raw);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refuse(reason: CimdRefusal): CimdOutcome {
  return { kind: 'invalid', reason };
}

function jwksOutcome(
  raw: Record<string, unknown>,
): { jwks: CimdClient['jwks']; jwksUri: string | null } | CimdRefusal {
  const { jwks, jwks_uri: jwksUri } = raw;
  if (jwks !== undefined && jwksUri !== undefined) return 'jwks_invalid';
  if (jwksUri !== undefined) {
    return typeof jwksUri === 'string' &&
      isAllowedRedirectUri(jwksUri) &&
      jwksUri.startsWith('https:')
      ? { jwks: null, jwksUri }
      : 'jwks_invalid';
  }
  if (jwks === undefined) return { jwks: null, jwksUri: null };
  if (!isRecord(jwks) || !Array.isArray(jwks.keys)) return 'jwks_invalid';
  const keys: unknown[] = jwks.keys;
  if (!keys.every(isRecord)) return 'jwks_invalid';
  return privateMemberRefusal(keys) === null ? { jwks: { keys }, jwksUri: null } : 'jwks_private';
}

// The document is fetched from the client's own URL, so it is untrusted
// input: nothing it says is taken without being checked here.
export function parseCimdDocument(clientIdUrl: string, body: unknown): CimdOutcome {
  if (!isRecord(body)) return refuse('not_an_object');
  if (body.client_id !== clientIdUrl) return refuse('client_id_mismatch');
  const name = body.client_name;
  if (typeof name !== 'string' || name.trim() === '' || name.length > NAME_MAX) {
    return refuse('client_name_missing');
  }
  const uris = body.redirect_uris;
  if (
    !Array.isArray(uris) ||
    uris.length === 0 ||
    uris.length > REDIRECT_URIS_MAX ||
    !uris.every((u) => typeof u === 'string')
  ) {
    return refuse('redirect_uris_invalid');
  }
  const redirectUris: string[] = uris;
  if (!redirectUris.every(isAllowedRedirectUri)) return refuse('redirect_uri_refused');
  if (Object.keys(body).some((key) => key.startsWith('client_secret'))) {
    return refuse('client_secret_present');
  }
  const method = body.token_endpoint_auth_method ?? 'none';
  if (method !== 'none' && method !== 'private_key_jwt') return refuse('auth_method_refused');
  const keys = jwksOutcome(body);
  if (typeof keys === 'string') return refuse(keys);
  // A key set with no key authenticates nobody, so it is no key source.
  if (
    method === 'private_key_jwt' &&
    keys.jwksUri === null &&
    (keys.jwks === null || keys.jwks.keys.length === 0)
  ) {
    return refuse('jwks_invalid');
  }
  return {
    kind: 'ok',
    client: {
      clientId: clientIdUrl,
      clientName: name.trim(),
      redirectUris,
      tokenEndpointAuthMethod: method,
      jwks: keys.jwks,
      jwksUri: keys.jwksUri,
      loopback: redirectUris.some((u) => isLoopbackHost(new URL(u).hostname)),
    },
  };
}

// What the consent page shows beside client_name, which the document chose
// freely and so can claim to be anyone.
export function cimdConsentHost(clientIdUrl: string): string {
  return new URL(clientIdUrl).host;
}

// Built from entries, not assigned member by member: a JWK member named
// `__proto__` would otherwise set the object's prototype instead of a key.
function stringMembers(key: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(key).filter(
      ([, value]) =>
        typeof value === 'string' ||
        (Array.isArray(value) && value.every((v) => typeof v === 'string')),
    ),
  );
}

// What a validated document is kept as: only the members the validator read,
// and of a JWK only its string members, so nothing the document author chose
// to put elsewhere (a number whose text is enormous, say) reaches storage.
export function projectCimdDocument(client: CimdClient): Record<string, unknown> {
  const projection: Record<string, unknown> = {
    client_id: client.clientId,
    client_name: client.clientName,
    redirect_uris: client.redirectUris,
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
  };
  if (client.jwks !== null) {
    projection.jwks = {
      keys: client.jwks.keys.map((key) => (isRecord(key) ? stringMembers(key) : {})),
    };
  }
  if (client.jwksUri !== null) {
    projection.jwks_uri = client.jwksUri;
  }
  return projection;
}
