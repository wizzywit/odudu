import { domainAddress, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { hostAccepted, originAccepted } from '#/service/origin-policy';

const PATH = pathAddress('https://idp.example', 'acme');
const DOMAIN = domainAddress('login.acme.com', true);
const DEV = pathAddress('http://localhost:3000', 'acme');

describe('hostAccepted', () => {
  it('accepts the host of the tenant’s address, with or without a port', () => {
    expect(hostAccepted('idp.example', PATH, true)).toBe(true);
    expect(hostAccepted('idp.example:443', PATH, true)).toBe(true);
    expect(hostAccepted('IDP.Example', PATH, true)).toBe(true);
    expect(hostAccepted('login.acme.com', DOMAIN, true)).toBe(true);
    expect(hostAccepted('localhost:3000', DEV, true)).toBe(true);
  });

  it.each([
    ['another host', 'evil.example'],
    ['a sibling label', 'x.idp.example'],
    ['a suffix of it', 'evilidp.example'],
    ['the tenant host at the wrong tenant’s domain', 'login.acme.com'],
    ['userinfo trick', 'evil.example@idp.example'],
    ['a path trick', 'idp.example/evil'],
    ['whitespace', 'idp.example evil'],
    ['an empty host', ''],
    ['a backslash', 'evil.example\\@idp.example'],
  ])('refuses %s', (_label, host) => {
    expect(hostAccepted(host, PATH, true)).toBe(false);
  });

  it('refuses a request with no Host', () => {
    expect(hostAccepted(undefined, PATH, true)).toBe(false);
  });
});

describe('originAccepted', () => {
  it('lets a request with no Origin through, as a client that is not a browser sends none', () => {
    expect(originAccepted(undefined, PATH, true)).toBe(true);
  });

  it('accepts the tenant’s own origin and no other', () => {
    expect(originAccepted('https://idp.example', PATH, true)).toBe(true);
    expect(originAccepted('https://idp.example:443', PATH, true)).toBe(true);
    expect(originAccepted('https://login.acme.com', DOMAIN, true)).toBe(true);
    expect(originAccepted('http://localhost:3000', DEV, true)).toBe(true);
  });

  it.each([
    'https://evil.example',
    'http://idp.example',
    'https://idp.example:8443',
    'https://idp.example.evil.example',
    'null',
    '',
    'not a url',
    'https://idp.example/path',
    'https://evil.example@idp.example',
  ])('refuses the origin %j', (origin) => {
    expect(originAccepted(origin, PATH, true)).toBe(false);
  });
});

describe('a trailing dot', () => {
  it('names the same host, as the issuer is spelled without it', () => {
    expect(hostAccepted('idp.example.', PATH, true)).toBe(true);
    expect(hostAccepted('idp.example.:443', PATH, true)).toBe(true);
    expect(hostAccepted('idp.example..', PATH, true)).toBe(false);
  });
});

describe('with no configured base address', () => {
  const FROM_REQUEST = pathAddress('http://evil.example', 'acme');
  const LOOPBACK = pathAddress('http://localhost:3000', 'acme');

  it.each(['localhost', 'localhost:3000', '127.0.0.1:8080', '[::1]:3000', 'LOCALHOST'])(
    'accepts the loopback host %s',
    (host) => {
      expect(hostAccepted(host, LOOPBACK, false)).toBe(true);
    },
  );

  it.each([
    'evil.example',
    'idp.example',
    '10.0.0.5',
    '192.168.1.2:3000',
    'localhost.evil.example',
  ])(
    'refuses %s, which the request itself would otherwise have named the tenant’s address',
    (host) => {
      expect(hostAccepted(host, pathAddress(`http://${host}`, 'acme'), false)).toBe(false);
    },
  );

  it('refuses an Origin that is not loopback, even one equal to the Host', () => {
    expect(originAccepted('http://evil.example', FROM_REQUEST, false)).toBe(false);
    expect(originAccepted('http://localhost:3000', LOOPBACK, false)).toBe(true);
    expect(originAccepted('http://127.0.0.1:3000', LOOPBACK, false)).toBe(false);
    expect(originAccepted(undefined, LOOPBACK, false)).toBe(true);
  });
});
