import { badProxyPath } from '#/services/errors';
import type { AuthState, Claims, Mode } from '#/types';

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

// `<name>/<path>` after the proxy mount, `<baseUrl>/proxy` unless the BFF's
// `proxyPath` says otherwise; a leading slash is tolerated.
export function proxyUrl(baseUrl: string, path: string, proxyPath?: string): string {
  return `${proxyPath ?? `${trimmed(baseUrl)}/proxy`}/${path.replace(/^\/+/u, '')}`;
}

// A proxy path is a path of this origin: one slash at the start, unreserved
// characters and slashes after, no dot segment, nothing at the end. A scheme, a
// host, a backslash or an escape never gets through.
const PROXY_PATH = /^\/[A-Za-z0-9_.~-]+(?:\/[A-Za-z0-9_.~-]+)*$/u;

export function checkedMode(mode: Mode): Mode {
  if (mode.kind !== 'bff' || mode.proxyPath === undefined) return mode;
  const dotted = mode.proxyPath.split('/').some((part) => part === '.' || part === '..');
  if (!PROXY_PATH.test(mode.proxyPath) || dotted) throw badProxyPath();
  return mode;
}

type HeadersSource = ConstructorParameters<typeof Headers>[0];

export function withBffHeader(headers: HeadersSource | undefined): Headers {
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
