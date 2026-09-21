// The default `ODUDU_TLS_CLIENT_CERT_HEADER` (packages/kernel/src/config.ts
// carries the same literal at the config boundary) — nginx's own
// `$ssl_client_s_dn` naming convention, kept only as a starting point: a
// deployment behind a different proxy overrides it, never edits this file.
export const DEFAULT_TLS_CLIENT_SUBJECT_HEADER = 'x-ssl-client-s-dn';

// RFC 8705 §2.1: proxy-terminated mutual TLS, the shape Odudu supports —
// it never terminates TLS itself (README.md's deployment section). The
// reverse proxy in front of it does the handshake and forwards the
// certificate's subject in a plain header; this module reads that header
// and decides whether the request behind it may authenticate as the client
// whose registered subject the caller compares it against
// (`authenticateTlsClientAuth`, usecase/token-issuance.ts).
export interface TlsClientAuthOptions {
  // The same flag that already governs whether Fastify trusts
  // `X-Forwarded-*` (`apps/server/src/app.ts`'s `trustProxy`). Off means
  // this header is exactly as untrustworthy as any other one a caller can
  // set for itself, so it is never read — refused, not downgraded.
  trustProxy: boolean;
  // `ODUDU_TLS_CLIENT_CERT_HEADER` — the name a deployment's own proxy
  // emits the subject under. nginx, Envoy, Apache and HAProxy each use a
  // different one; Odudu does not get to fix it, so it is configuration,
  // never a constant here. Any casing: this module lower-cases it before
  // use, so the invariant does not depend on where the value came from.
  headerName: string;
}

export type TlsClientSubjectResult =
  { kind: 'absent' } | { kind: 'duplicated' } | { kind: 'present'; subject: string };

// A header sent twice, or appended to by a proxy that did not strip a
// caller-supplied copy first, must never resolve to either value. Not
// `headers[name]`: Node's http parser joins most repeats (this header
// included) into one ", "-separated string, indistinguishable from an
// ordinary comma-bearing DN — see `tlsClientAuthSubjectMatches`'s comment,
// and the false version of this reasoning this file used to carry.
// `rawHeaders` (Node's flat, duplicate-preserving pairs) counts exactly.
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

  // Node lower-cases what it parses, so the configured name has to match
  // that however a deployment spelled it.
  const name = options.headerName.toLowerCase();
  const value = headers[name];
  if (typeof value !== 'string' || value.length === 0) return { kind: 'absent' };
  if (countHeaderOccurrences(rawHeaders, name) > 1) return { kind: 'duplicated' };

  return { kind: 'present', subject: value };
}

// RFC 8705 §2.1 asks for "a predictable treatment of DN values, such as the
// distinguishedNameMatch rule from [RFC4517]" — Odudu implements neither;
// this is exact string comparison after trimming surrounding whitespace, a
// deliberate simplification, correct only as far as the proxy emits the
// subject in one stable, canonical form every time. A comma inside an RDN
// value is ordinary (RFC 2253 escapes it `\,`, keeping the space after),
// so nothing here treats `, ` as a signal of anything.
export function tlsClientAuthSubjectMatches(presented: string, registered: string): boolean {
  return presented.trim() === registered.trim();
}
