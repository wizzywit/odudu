import { describe, expect, it } from 'vitest';
import { tlsClientAuthSubjectMatches, tlsClientSubject } from '#/service/tls-client-auth';

const HEADER = 'x-ssl-client-s-dn';
const trusted = { trustProxy: true, headerName: HEADER };

function rawHeadersFor(...pairs: [string, string][]): string[] {
  return pairs.flat();
}

describe('[RFC8705-2.1-01] tlsClientSubject', () => {
  it('reads the subject from the header when the proxy is trusted', () => {
    const headers = { [HEADER]: 'CN=client-a,O=Example' };
    const rawHeaders = rawHeadersFor(['X-SSL-Client-S-DN', 'CN=client-a,O=Example']);
    expect(tlsClientSubject(headers, rawHeaders, trusted)).toEqual({
      kind: 'present',
      subject: 'CN=client-a,O=Example',
    });
  });

  it('reads nothing when the proxy is not trusted, whatever the header says', () => {
    const headers = { [HEADER]: 'CN=client-a,O=Example' };
    const rawHeaders = rawHeadersFor(['X-SSL-Client-S-DN', 'CN=client-a,O=Example']);
    expect(
      tlsClientSubject(headers, rawHeaders, { trustProxy: false, headerName: HEADER }),
    ).toEqual({ kind: 'absent' });
  });

  it('reads nothing when the header is absent', () => {
    expect(tlsClientSubject({}, [], trusted)).toEqual({ kind: 'absent' });
  });

  it('reads nothing when the header is empty', () => {
    const headers = { [HEADER]: '' };
    expect(tlsClientSubject(headers, rawHeadersFor(['X-SSL-Client-S-DN', '']), trusted)).toEqual({
      kind: 'absent',
    });
  });

  // The security case: a client smuggled its own value past a proxy that
  // appended one, or the proxy itself sent the header twice. Verified
  // against Node's actual duplicate-header behavior in the integration
  // suite (raw socket probe); here the fixture states the shape directly —
  // two entries under the same name in `rawHeaders`, case-insensitively,
  // regardless of what `headers[...]` folded them into.
  it('reads "duplicated" when rawHeaders carries the header twice', () => {
    const headers = { [HEADER]: 'CN=client-a,O=Example, CN=attacker' };
    const rawHeaders = rawHeadersFor(
      ['X-SSL-Client-S-DN', 'CN=client-a,O=Example'],
      ['x-ssl-client-s-dn', 'CN=attacker'],
    );
    expect(tlsClientSubject(headers, rawHeaders, trusted)).toEqual({ kind: 'duplicated' });
  });

  // The false-positive this replaced: an ordinary certificate whose
  // organization contains a comma renders with ", " in every common DN
  // encoding (RFC 2253's own escaping keeps the space after `\,`; oneline
  // and compat/legacy forms use a literal ", " too). None of these may be
  // mistaken for a duplicate — rawHeaders carries the header exactly once.
  it.each([
    ['RFC 2253 (nginx $ssl_client_s_dn)', 'CN=client-a,O=Example\\, Inc.'],
    ['oneline', 'O = "Example, Inc.", CN = client-a'],
    ['compat/legacy (Apache SSL_CLIENT_S_DN)', '/O=Example, Inc./CN=client-a'],
  ])('reads a legitimate comma-bearing subject sent once (%s)', (_name, subject) => {
    const headers = { [HEADER]: subject };
    const rawHeaders = rawHeadersFor(['X-SSL-Client-S-DN', subject]);
    expect(tlsClientSubject(headers, rawHeaders, trusted)).toEqual({ kind: 'present', subject });
  });
});

describe('[RFC8705-2.1-02] tlsClientAuthSubjectMatches', () => {
  it('matches an identical subject', () => {
    expect(tlsClientAuthSubjectMatches('CN=client-a,O=Example', 'CN=client-a,O=Example')).toBe(
      true,
    );
  });

  it('refuses a different subject', () => {
    expect(tlsClientAuthSubjectMatches('CN=someone-else', 'CN=client-a,O=Example')).toBe(false);
  });

  it('is case-sensitive, the exact-match simplification stated on the function', () => {
    expect(tlsClientAuthSubjectMatches('cn=client-a,O=Example', 'CN=client-a,O=Example')).toBe(
      false,
    );
  });

  it('ignores only surrounding whitespace, not whitespace inside the value', () => {
    expect(tlsClientAuthSubjectMatches('  CN=client-a,O=Example  ', 'CN=client-a,O=Example')).toBe(
      true,
    );
    expect(tlsClientAuthSubjectMatches('CN=client-a, O=Example', 'CN=client-a,O=Example')).toBe(
      false,
    );
  });

  it('matches a legitimate comma-bearing subject presented identically', () => {
    expect(
      tlsClientAuthSubjectMatches('CN=client-a,O=Example\\, Inc.', 'CN=client-a,O=Example\\, Inc.'),
    ).toBe(true);
  });
});
