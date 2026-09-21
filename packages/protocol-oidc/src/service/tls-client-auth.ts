// RFC 8705 §2.1: proxy-terminated mutual TLS, the shape Odudu supports —
// it never terminates TLS itself (README.md's deployment section). The
// reverse proxy in front of it does the handshake and forwards the
// certificate's subject in a plain header; this module reads that header
// and decides whether the request behind it may authenticate as the client
// whose registered subject the caller compares it against
// (`authenticateTlsClientAuth`, usecase/token-issuance.ts).
export const TLS_CLIENT_SUBJECT_HEADER = 'x-ssl-client-s-dn';

export interface TlsClientAuthOptions {
  // The same flag that already governs whether Fastify trusts
  // `X-Forwarded-*` (`apps/server/src/app.ts`'s `trustProxy`). Off means
  // this header is exactly as untrustworthy as any other one a caller can
  // set for itself, so it is never read — refused, not downgraded.
  trustProxy: boolean;
}

// Verified empirically (`node -e` against a raw socket sending the header
// twice): unlike `set-cookie`, Node's http parser joins a repeated header
// into one string with ", " rather than an array. A canonical subject DN
// (`tlsClientAuthSubjectMatches` below) never contains that substring, so
// its presence can only mean the header arrived, or was appended, twice —
// refused rather than picking a value, since picking either lets that
// client choose which one wins.
const DUPLICATE_HEADER_MARKER = ', ';

export function tlsClientSubject(
  headers: Record<string, string | string[] | undefined>,
  options: TlsClientAuthOptions,
): string | null {
  if (!options.trustProxy) return null;

  const value = headers[TLS_CLIENT_SUBJECT_HEADER];
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.includes(DUPLICATE_HEADER_MARKER)) return null;

  return value;
}

// RFC 8705 §2.1 asks for "a predictable treatment of DN values, such as the
// distinguishedNameMatch rule from [RFC4517]" — Odudu implements neither;
// this is exact string comparison after trimming surrounding whitespace, a
// deliberate simplification. It is only as correct as the deployment's
// proxy: two DNs denoting the same identity fail to match here unless the
// proxy emits the subject in one stable, canonical form every time.
export function tlsClientAuthSubjectMatches(presented: string, registered: string): boolean {
  return presented.trim() === registered.trim();
}
