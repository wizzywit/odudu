import { describe, expect, it } from 'vitest';
import { tlsClientAuthSubjectMatches, tlsClientSubject } from '#/service/tls-client-auth';

const headers = { 'x-ssl-client-s-dn': 'CN=client-a,O=Example' };
// Node's http parser joins a header sent twice with ", " rather than
// handing it over as an array — verified empirically against a raw socket,
// see tls-client-auth.ts's own comment on DUPLICATE_HEADER_MARKER. This is
// the shape a duplicated header actually arrives in.
const duplicated = { 'x-ssl-client-s-dn': 'CN=client-a,O=Example, CN=attacker' };

describe('[RFC8705-2.1-01] tlsClientSubject', () => {
  it('reads the subject from the header when the proxy is trusted', () => {
    expect(tlsClientSubject(headers, { trustProxy: true })).toBe('CN=client-a,O=Example');
  });

  it('reads nothing when the proxy is not trusted, whatever the header says', () => {
    expect(tlsClientSubject(headers, { trustProxy: false })).toBeNull();
  });

  it('reads nothing when the header is absent', () => {
    expect(tlsClientSubject({}, { trustProxy: true })).toBeNull();
  });

  it('reads nothing when the header appears twice', () => {
    expect(tlsClientSubject(duplicated, { trustProxy: true })).toBeNull();
  });

  it('reads nothing when the header is empty', () => {
    expect(tlsClientSubject({ 'x-ssl-client-s-dn': '' }, { trustProxy: true })).toBeNull();
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
});
