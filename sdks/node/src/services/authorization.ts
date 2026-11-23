// RFC 6750 §2.1: `Bearer` followed by one token68 (RFC 7235 §2.1).
const TOKEN68 = /^[A-Za-z0-9\-._~+/]+=*$/u;

export type Credentials =
  | { kind: 'token'; token: string }
  // Nothing was sent, or a scheme this API does not take: RFC 6750 §3.1 wants
  // a challenge with no error code.
  | { kind: 'none' }
  // Several Authorization headers, or a Bearer value that is not `Bearer <token>`.
  | { kind: 'malformed' };

// Node keeps only the first of several Authorization headers in `headers`, so
// the raw header list is read when there is one.
export function authorizationValues(
  rawHeaders: readonly string[] | undefined,
  header: string | readonly string[] | undefined,
): string[] {
  const raw: string[] = [];
  for (let i = 0; i + 1 < (rawHeaders?.length ?? 0); i += 2) {
    if (rawHeaders?.[i]?.toLowerCase() === 'authorization') raw.push(rawHeaders[i + 1] ?? '');
  }
  if (raw.length > 0) return raw;
  if (header === undefined) return [];
  return typeof header === 'string' ? [header] : [...header];
}

export function readCredentials(values: readonly string[]): Credentials {
  const [only, ...more] = values;
  if (only === undefined) return { kind: 'none' };
  if (more.length > 0) return { kind: 'malformed' };
  const space = only.indexOf(' ');
  const scheme = space === -1 ? only : only.slice(0, space);
  if (scheme.toLowerCase() !== 'bearer') return { kind: 'none' };
  const token = space === -1 ? '' : only.slice(space + 1);
  return TOKEN68.test(token) ? { kind: 'token', token } : { kind: 'malformed' };
}
