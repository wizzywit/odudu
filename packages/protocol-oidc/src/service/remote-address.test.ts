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
    expect(() => assertFetchableUrl('not a url')).toThrow(/scheme/u);
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
    // IPv4-mapped IPv6: loopback wearing a different hat. A v6-only range
    // check would wave this through without normalising it to its v4 form
    // first.
    ['loopback, as an IPv4-mapped IPv6 address', ['::ffff:127.0.0.1']],
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
