import { describe, expect, it } from 'vitest';
import { assertFetchableUrl, assertPublicAddresses } from '#/service/remote-address';

describe('a URL the server will fetch on a client’s say-so', () => {
  it('accepts an https URL', () => {
    expect(assertFetchableUrl('https://rp.example/jwks.json').host).toBe('rp.example');
  });

  it.each([
    'http://rp.example/j',
    'file:///etc/passwd',
    'data:application/json,{}',
    'ftp://rp.example/j',
  ])('refuses %s', (raw) => {
    expect(() => assertFetchableUrl(raw)).toThrow(/scheme/u);
  });

  it('refuses a URL with embedded credentials', () => {
    expect(() => assertFetchableUrl('https://user:pw@rp.example/j')).toThrow(/credentials/u);
  });

  it('refuses a URL that fails to parse, without leaking a raw TypeError', () => {
    expect(() => assertFetchableUrl('not a url')).toThrow(/does not parse/u);
  });

  // Every address the name resolves to, not the first: a name answering
  // with one public and one loopback address is the attack, not an
  // accident.
  it.each([
    ['loopback', ['127.0.0.1']],
    ['loopback v6', ['::1']],
    ['link-local, where a cloud metadata service lives', ['169.254.169.254']],
    ['private class A', ['10.0.0.5']],
    ['private class B', ['172.16.0.5']],
    ['private class B, top of the /12', ['172.31.255.254']],
    ['private class C', ['192.168.1.5']],
    ['unique local v6', ['fc00::1']],
    ['link-local v6', ['fe80::1']],
    ['unspecified', ['0.0.0.0']],
    ['unspecified v6', ['::']],
    ['multicast', ['224.0.0.1']],
    ['multicast v6', ['ff02::1']],
    ['one public and one loopback', ['93.184.216.34', '127.0.0.1']],
    ['broadcast', ['255.255.255.255']],
    ['reserved, class E', ['240.0.0.1']],
    ['IETF protocol assignment', ['192.0.0.5']],
    ['carrier-grade NAT', ['100.64.0.1']],
    // IPv4-mapped IPv6, in every spelling a resolver or a client's own
    // `new URL` normalisation can produce — not just the dotted form. Each
    // one carries the same 32 bits as a bare IPv4 address in the last two
    // hextets, and a v6-only range check (or a parser that mis-reads the
    // dotted quad as hex) waves every one of these through.
    ['loopback, dotted IPv4-mapped', ['::ffff:127.0.0.1']],
    ['loopback, hex IPv4-mapped, compressed', ['::ffff:7f00:1']],
    ['loopback, hex IPv4-mapped, fully written', ['0:0:0:0:0:ffff:127.0.0.1']],
    [
      'loopback, hex IPv4-mapped, fully written with leading zeros',
      ['0000:0000:0000:0000:0000:ffff:127.0.0.1'],
    ],
    ['the metadata service, hex IPv4-mapped', ['::ffff:a9fe:a9fe']],
    ['loopback, dotted IPv4-compatible (deprecated, zero marker)', ['::127.0.0.1']],
    ['loopback, hex IPv4-compatible (deprecated, zero marker)', ['::7f00:1']],
    ['loopback, reached through the NAT64 well-known prefix', ['64:ff9b::127.0.0.1']],
    // Node's net.isIPv6 rejects every genuinely malformed spelling tried
    // against it (checked directly: out-of-range octets, too many groups,
    // a doubled "::", an over-long group), so there is no live input that
    // reaches the parser while being unparseable. What a careless
    // implementation can still get wrong is case: the marker is valid
    // both as "ffff" and "FFFF".
    ['loopback, IPv4-mapped with an upper-case marker', ['::FFFF:127.0.0.1']],
  ])('refuses %s', (_name, addresses) => {
    expect(() => {
      assertPublicAddresses(addresses);
    }).toThrow(/address/u);
  });

  it('accepts a public address', () => {
    expect(() => {
      assertPublicAddresses(['93.184.216.34']);
    }).not.toThrow();
  });

  // A dotted IPv4 suffix does not by itself mean "embedded IPv4 to
  // unwrap" — only the mapped/compatible and NAT64 well-known prefixes do.
  // An ordinary global address that happens to spell its last 32 bits as
  // a dotted quad must not be swept into the IPv4 checks by that alone.
  it('accepts a public IPv6 address that uses dotted notation for its own sake', () => {
    expect(() => {
      assertPublicAddresses(['2001:db8::192.168.1.1']);
    }).not.toThrow();
  });

  // 172.32.0.0 is one address past the top of 172.16.0.0/12 — a prefix
  // match on "172." or "172.1"–"172.3" gets this wrong; only a numeric
  // range check over the second octet gets it right.
  it('accepts an address just outside the private /12, not swept in by a prefix match', () => {
    expect(() => {
      assertPublicAddresses(['172.32.0.1']);
    }).not.toThrow();
  });

  it('accepts a private address only where a deployment has allowed it', () => {
    expect(() => {
      assertPublicAddresses(['10.0.0.5'], { allowPrivate: true });
    }).not.toThrow();
  });

  it('still refuses loopback and multicast even where private ranges are allowed', () => {
    expect(() => {
      assertPublicAddresses(['127.0.0.1'], { allowPrivate: true });
    }).toThrow(/address/u);
    expect(() => {
      assertPublicAddresses(['224.0.0.1'], { allowPrivate: true });
    }).toThrow(/address/u);
  });
});
