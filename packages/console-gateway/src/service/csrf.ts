export type CsrfRefusal = 'origin-missing' | 'origin-mismatch' | 'console-header-missing';

export interface CsrfRequest {
  readonly method: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

// The custom header cannot be sent cross-origin without a CORS preflight,
// which nothing here grants; the Origin check refuses what SameSite lets
// through from a sibling site. `origin` is the configured base's origin.
export function csrfRefusal(request: CsrfRequest, origin: string): CsrfRefusal | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;
  const sent = request.headers.origin;
  if (sent === undefined) return 'origin-missing';
  if (sent !== origin) return 'origin-mismatch';
  if (request.headers['x-odudu-console'] !== '1') return 'console-header-missing';
  return null;
}
