import { type PendingRequest } from '@odudu/authn-flows';
import { pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { errorRedirect } from '#/usecase/login-submission';

const pending: PendingRequest = {
  clientId: 'portal',
  redirectUri: 'https://app.example/cb',
  scope: 'openid',
  state: 'xyz',
  nonce: null,
  codeChallenge: 'c',
  codeChallengeMethod: 'S256',
};

describe('errorRedirect', () => {
  it.each([
    ['access_denied', 'The user did not allow the request.'],
    ['login_required', 'The user is not signed in.'],
    ['consent_required', 'The user has not agreed to this request yet.'],
  ] as const)('carries the plain sentence for %s, beside state and iss', (code, sentence) => {
    const back = new URL(errorRedirect(pending, pathAddress('https://id.example', 'acme'), code));
    expect(back.searchParams.get('error')).toBe(code);
    expect(back.searchParams.get('error_description')).toBe(sentence);
    expect(back.searchParams.get('state')).toBe('xyz');
    expect(back.searchParams.get('iss')).toBe('https://id.example/tenants/acme');
  });
});
