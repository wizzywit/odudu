import { describe, expect, it } from 'vitest';
import {
  canonicalHost,
  challengeName,
  newChallenge,
  refuseHost,
  txtMatchesChallenge,
} from '#/service/tenant-domain';

const OPERATOR = 'id.operator.net';

describe('canonicalHost', () => {
  it.each([
    ['LOGIN.Acme.COM.:443', 'login.acme.com'],
    ['login.acme.com:80', 'login.acme.com'],
    ['login.acme.com.', 'login.acme.com'],
    ['Login.Acme.com', 'login.acme.com'],
  ])('spells %s as %s', (raw, expected) => {
    expect(canonicalHost(raw)).toBe(expected);
  });

  it('reads unicode and xn-- spellings as one name', () => {
    expect(canonicalHost('Bücher.de')).toBe('xn--bcher-kva.de');
    expect(canonicalHost('xn--bcher-kva.de')).toBe(canonicalHost('BÜCHER.de'));
  });

  it.each(['192.0.2.1', '[::1]', 'acme', 'a b.com', 'a_b.com', 'login.acme.com:8443', '', '.com'])(
    'is null for %j',
    (raw) => {
      expect(canonicalHost(raw)).toBeNull();
    },
  );

  it('is null for a name over 253 characters', () => {
    expect(canonicalHost(`${'a'.repeat(60)}.`.repeat(5) + 'com')).toBeNull();
  });
});

describe('refuseHost', () => {
  it.each([
    ['192.0.2.1', 'ip_literal'],
    ['192.0.2.1:8080', 'ip_literal'],
    ['[::1]', 'ip_literal'],
    ['[::1]:8443', 'ip_literal'],
    ['localhost', 'localhost'],
    ['x.localhost', 'localhost'],
    ['a.test', 'reserved_name'],
    ['a.example', 'reserved_name'],
    ['a.invalid', 'reserved_name'],
    ['a.local', 'reserved_name'],
    ['example.com', 'reserved_name'],
    ['www.example.org', 'reserved_name'],
    ['sub.example.net', 'reserved_name'],
    [OPERATOR, 'operator_host'],
    ['ID.Operator.NET.', 'operator_host'],
    ['login.acme.com:8443', 'invalid'],
    ['acme', 'invalid'],
    ['a_b.com', 'invalid'],
  ])('refuses %s as %s', (host, refusal) => {
    expect(refuseHost(host, OPERATOR)).toBe(refusal);
  });

  it.each(['login.acme.com', 'login.acme.com:443', 'acme.id.operator.net', 'Bücher.de'])(
    'accepts %s',
    (host) => {
      expect(refuseHost(host, OPERATOR)).toBeNull();
    },
  );

  it('compares the operator host without its port', () => {
    expect(refuseHost('id.operator.net', 'id.operator.net:8443')).toBe('operator_host');
  });
});

describe('refuseHost on spellings that fold to a refused name', () => {
  it.each([
    ['id\u3002operator.net', 'operator_host'],
    ['id\uff0eoperator\uff61net', 'operator_host'],
    ['\uff29\uff24.operator.net', 'operator_host'],
    ['x\u3002localhost', 'localhost'],
    ['\uff4c\uff4f\uff43\uff41\uff4c\uff48\uff4f\uff53\uff54', 'localhost'],
    ['a\u3002test', 'reserved_name'],
  ])('refuses %j as %s', (host, refusal) => {
    expect(refuseHost(host, OPERATOR)).toBe(refusal);
  });

  it('compares an operator host written in unicode with its punycode form', () => {
    expect(refuseHost('xn--bcher-kva.de', 'B\u00fccher.de')).toBe('operator_host');
    expect(refuseHost('B\u00fccher.de', 'xn--bcher-kva.de')).toBe('operator_host');
  });
});

describe('ports', () => {
  it.each(['login.acme.com:', 'login.acme.com:0443', 'login.acme.com:00080', 'login.acme.com:0'])(
    'refuses %s as invalid and canonicalises it to nothing',
    (host) => {
      expect(refuseHost(host, OPERATOR)).toBe('invalid');
      expect(canonicalHost(host)).toBeNull();
    },
  );
});

describe('the challenge', () => {
  it('is published under a label of the host', () => {
    expect(challengeName('login.acme.com')).toBe('_odudu-challenge.login.acme.com');
  });

  it('is prefixed base64url of the random bytes', () => {
    const bytes = Buffer.alloc(32, 0xfb);
    expect(newChallenge(() => bytes)).toBe(
      `odudu-domain-verification=${bytes.toString('base64url')}`,
    );
  });

  it('refuses fewer than 32 random bytes', () => {
    expect(() => newChallenge(() => Buffer.alloc(31))).toThrow(/32/u);
  });

  it('matches a record only when its joined chunks equal the challenge', () => {
    expect(txtMatchesChallenge([['v=spf1'], ['abc', 'def']], 'abcdef')).toBe(true);
    expect(txtMatchesChallenge([['abcdefg'], ['abc']], 'abcdef')).toBe(false);
    expect(txtMatchesChallenge([], 'abcdef')).toBe(false);
  });
});
