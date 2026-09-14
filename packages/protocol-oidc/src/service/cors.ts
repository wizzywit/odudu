import { normalizeOrigin } from '#/service/web-origin';

const PREFLIGHT_HEADERS = {
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '600',
} as const;

// `Vary: Origin` is set whether or not the origin was allowed: without it a
// shared cache can serve one origin's allowed response to another.
export function corsHeadersForPreflight(
  origin: string | undefined,
  allowed: ReadonlySet<string>,
): Record<string, string> | null {
  const echoed = allowedOrigin(origin, allowed);
  if (echoed === null) return null;
  return { 'access-control-allow-origin': echoed, ...PREFLIGHT_HEADERS, vary: 'Origin' };
}

export function corsHeadersForRequest(
  origin: string | undefined,
  allowed: ReadonlySet<string>,
): Record<string, string> {
  const echoed = allowedOrigin(origin, allowed);
  return echoed === null
    ? { vary: 'Origin' }
    : { 'access-control-allow-origin': echoed, vary: 'Origin' };
}

function allowedOrigin(origin: string | undefined, allowed: ReadonlySet<string>): string | null {
  if (origin === undefined) return null;
  const normalized = normalizeOrigin(origin);
  if (normalized === null || !allowed.has(normalized)) return null;
  return normalized;
}
