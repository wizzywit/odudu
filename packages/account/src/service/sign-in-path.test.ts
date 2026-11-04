import { describe, expect, it } from 'vitest';
import { MAX_SIGN_IN_PATH_LENGTH, pathAddress } from '@odudu/kernel';
import { signInPath } from '#/service/sign-in-path';

const AUTH = '/tenants/acme/protocol/openid-connect/auth';
const GOOD = `${AUTH}?response_type=code&client_id=portal&redirect_uri=https%3A%2F%2Fapp.example%2Fcb&state=a%20b`;

describe('signInPath', () => {
  it('keeps the authorize path of this tenant, query and all', () => {
    expect(signInPath(pathAddress('https://idp.example', 'acme'), GOOD)).toBe(GOOD);
  });

  it('refuses anything that is not a single string', () => {
    expect(signInPath(pathAddress('https://idp.example', 'acme'), undefined)).toBeNull();
    expect(signInPath(pathAddress('https://idp.example', 'acme'), [GOOD, GOOD])).toBeNull();
    expect(signInPath(pathAddress('https://idp.example', 'acme'), '')).toBeNull();
  });

  it.each([
    ['another tenant', '/tenants/other/protocol/openid-connect/auth?client_id=x'],
    ['another endpoint', '/tenants/acme/protocol/openid-connect/token?client_id=x'],
    ['no query', AUTH],
    ['an absolute URL', `https://evil.example${GOOD}`],
    ['a scheme-relative URL', `//evil.example${GOOD}`],
    ['a backslash', `${AUTH}?x=\\evil`],
    ['a fragment', `${GOOD}#frag`],
    ['a space', `${AUTH}?x=a b`],
    ['a control character', `${AUTH}?x=a\u0001b`],
    ['a line break', `${AUTH}?x=a\r\nb`],
    ['a non-ASCII character', `${AUTH}?x=é`],
    ['a longer tenant name', '/tenants/acmeX/protocol/openid-connect/auth?client_id=x'],
    ['a dot segment', `/tenants/acme/protocol/openid-connect/../openid-connect/auth?client_id=x`],
  ])('refuses %s', (_label, value) => {
    expect(signInPath(pathAddress('https://idp.example', 'acme'), value)).toBeNull();
  });

  it('matches a tenant name that needs encoding only in its encoded form', () => {
    const path = '/tenants/a%20b/protocol/openid-connect/auth?client_id=x';
    expect(signInPath(pathAddress('https://idp.example', 'a b'), path)).toBe(path);
    expect(
      signInPath(
        pathAddress('https://idp.example', 'a b'),
        '/tenants/a b/protocol/openid-connect/auth?client_id=x',
      ),
    ).toBeNull();
  });

  it('refuses a value past the length bound', () => {
    const long = `${AUTH}?x=${'a'.repeat(MAX_SIGN_IN_PATH_LENGTH)}`;
    expect(signInPath(pathAddress('https://idp.example', 'acme'), long)).toBeNull();
  });
});
