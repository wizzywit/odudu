// The default `ODUDU_TLS_CLIENT_CERT_HEADER`, also at the config boundary
// in packages/kernel/src/config.ts. nginx's `$ssl_client_s_dn` convention.
export const DEFAULT_TLS_CLIENT_SUBJECT_HEADER = 'x-ssl-client-s-dn';

// RFC 8705 §2.1, proxy-terminated: Odudu never handshakes, so a reverse
// proxy forwards the certificate's subject in a plain header.
export interface TlsClientAuthOptions {
  // The same flag governing whether Fastify trusts `X-Forwarded-*`. Off
  // means the header is as untrustworthy as any a caller sets for itself,
  // so it is never read — refused, not downgraded.
  trustProxy: boolean;
  // Every proxy emits the subject under a different name, so this is
  // configuration. Any casing — `tlsClientSubject` lower-cases it, as Node
  // does what it parses.
  headerName: string;
}

export type TlsClientSubjectResult =
  { kind: 'absent' } | { kind: 'duplicated' } | { kind: 'present'; subject: string };

// Node joins repeated headers with ", ", which an ordinary comma-bearing DN
// is indistinguishable from — hence the raw pairs, not `headers[name]`.
function countHeaderOccurrences(rawHeaders: readonly string[], name: string): number {
  let count = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name) count += 1;
  }
  return count;
}

export function tlsClientSubject(
  headers: Record<string, string | string[] | undefined>,
  rawHeaders: readonly string[],
  options: TlsClientAuthOptions,
): TlsClientSubjectResult {
  if (!options.trustProxy) return { kind: 'absent' };

  const name = options.headerName.toLowerCase();
  const value = headers[name];
  if (typeof value !== 'string' || value.length === 0) return { kind: 'absent' };
  if (countHeaderOccurrences(rawHeaders, name) > 1) return { kind: 'duplicated' };

  return { kind: 'present', subject: value };
}

// Exact comparison after trimming, not RFC 4517's `distinguishedNameMatch`:
// a deliberate simplification, correct only as far as the proxy emits one
// canonical form every time. `docs/protocols/rfc8705.md`'s "The subject
// comparison is exact-match" has the reasoning.
export function tlsClientAuthSubjectMatches(presented: string, registered: string): boolean {
  return presented.trim() === registered.trim();
}
