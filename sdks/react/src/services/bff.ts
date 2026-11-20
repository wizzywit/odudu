import type { AuthState, Claims } from '#/types';

export const BFF_HEADER = 'X-Odudu-BFF';

function trimmed(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, '');
}

export function loginUrl(baseUrl: string): string {
  return `${trimmed(baseUrl)}/login`;
}

export function sessionUrl(baseUrl: string): string {
  return `${trimmed(baseUrl)}/session`;
}

export function logoutUrl(baseUrl: string): string {
  return `${trimmed(baseUrl)}/logout`;
}

// `<name>/<path>` after the proxy mount; a leading slash is tolerated.
export function proxyUrl(baseUrl: string, path: string): string {
  return `${trimmed(baseUrl)}/proxy/${path.replace(/^\/+/u, '')}`;
}

export function withBffHeader(headers: HeadersInit | undefined): Headers {
  const merged = new Headers(headers);
  merged.set(BFF_HEADER, '1');
  return merged;
}

function isClaims(value: unknown): value is Claims {
  return (
    typeof value === 'object' && value !== null && 'sub' in value && typeof value.sub === 'string'
  );
}

// The BFF answers `{ authenticated, claims }`; anything else is no session.
export function sessionStateOf(body: unknown): AuthState {
  const claims =
    typeof body === 'object' &&
    body !== null &&
    'authenticated' in body &&
    body.authenticated === true &&
    'claims' in body
      ? body.claims
      : undefined;
  return isClaims(claims)
    ? { status: 'signedIn', claims, error: undefined }
    : { status: 'signedOut', claims: undefined, error: undefined };
}

export function redirectOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || !('redirectTo' in body)) return undefined;
  return typeof body.redirectTo === 'string' ? body.redirectTo : undefined;
}
