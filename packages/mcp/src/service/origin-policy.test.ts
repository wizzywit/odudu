import { domainAddress, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { hostAccepted, originAccepted } from '#/service/origin-policy';

const PATH = pathAddress('https://idp.example', 'acme');
const DOMAIN = domainAddress('login.acme.com', true);
const DEV = pathAddress('http://localhost:3000', 'acme');

describe('hostAccepted', () => {
  it('accepts the host of the tenant’s address, with or without a port', () => {
    expect(hostAccepted('idp.example', PATH)).toBe(true);
    expect(hostAccepted('idp.example:443', PATH)).toBe(true);
    expect(hostAccepted('IDP.Example', PATH)).toBe(true);
    expect(hostAccepted('login.acme.com', DOMAIN)).toBe(true);
    expect(hostAccepted('localhost:3000', DEV)).toBe(true);
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
    expect(hostAccepted(host, PATH)).toBe(false);
  });

  it('refuses a request with no Host', () => {
    expect(hostAccepted(undefined, PATH)).toBe(false);
  });
});

describe('originAccepted', () => {
  it('lets a request with no Origin through, as a client that is not a browser sends none', () => {
    expect(originAccepted(undefined, PATH)).toBe(true);
  });

  it('accepts the tenant’s own origin and no other', () => {
    expect(originAccepted('https://idp.example', PATH)).toBe(true);
    expect(originAccepted('https://idp.example:443', PATH)).toBe(true);
    expect(originAccepted('https://login.acme.com', DOMAIN)).toBe(true);
    expect(originAccepted('http://localhost:3000', DEV)).toBe(true);
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
    expect(originAccepted(origin, PATH)).toBe(false);
  });
});
