import { describe, expect, it } from 'vitest';
import { evaluateAuthorizationCodeGrant } from '#/service/authorization-code-grant';
import { type AuthorizationCodeRecord } from '#/schema/authorization-codes';
import { type ClientRecord } from '@odudu/domain-realm';

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const client: ClientRecord = {
  id: 'client-1',
  realmId: 'realm-1',
  clientId: 'web-app',
  name: 'Web app',
  enabled: true,
  type: 'confidential',
  secretHash: 'hashed:secret',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  serviceSubjectId: null,
};

const record: AuthorizationCodeRecord = {
  codeHash: 'hash-1',
  realmId: 'realm-1',
  clientId: client.id,
  subjectId: 'subject-1',
  redirectUri: 'https://app.example/callback',
  scope: 'openid',
  nonce: null,
  codeChallenge: CHALLENGE,
  codeChallengeMethod: 'S256',
  authTime: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: new Date('2026-01-01T00:01:00.000Z'),
  consumedAt: null,
  grantId: null,
};

describe('evaluateAuthorizationCodeGrant', () => {
  it('accepts a matching client, redirect_uri and code_verifier', () => {
    const decision = evaluateAuthorizationCodeGrant(record, client, {
      redirectUri: record.redirectUri,
      codeVerifier: VERIFIER,
    });
    expect(decision).toEqual({ ok: true });
  });

  it('rejects a code issued to a different client', () => {
    const otherClient: ClientRecord = { ...client, id: 'client-2', clientId: 'other-app' };
    const decision = evaluateAuthorizationCodeGrant(record, otherClient, {
      redirectUri: record.redirectUri,
      codeVerifier: VERIFIER,
    });
    expect(decision).toEqual({ ok: false, reason: 'client_mismatch' });
  });

  it('rejects a redirect_uri that does not match the one bound to the code', () => {
    const decision = evaluateAuthorizationCodeGrant(record, client, {
      redirectUri: 'https://app.example/other-callback',
      codeVerifier: VERIFIER,
    });
    expect(decision).toEqual({ ok: false, reason: 'redirect_uri_mismatch' });
  });

  it('rejects a wrong code_verifier', () => {
    const decision = evaluateAuthorizationCodeGrant(record, client, {
      redirectUri: record.redirectUri,
      codeVerifier: 'x'.repeat(43),
    });
    expect(decision).toEqual({ ok: false, reason: 'pkce_mismatch' });
  });

  it('rejects a missing code_verifier the same way as a wrong one', () => {
    const decision = evaluateAuthorizationCodeGrant(record, client, {
      redirectUri: record.redirectUri,
      codeVerifier: '',
    });
    expect(decision).toEqual({ ok: false, reason: 'pkce_mismatch' });
  });

  it('checks client and redirect_uri before PKCE, so a wrong client is never reported as a PKCE failure', () => {
    const otherClient: ClientRecord = { ...client, id: 'client-2', clientId: 'other-app' };
    const decision = evaluateAuthorizationCodeGrant(record, otherClient, {
      redirectUri: 'https://app.example/other-callback',
      codeVerifier: 'x'.repeat(43),
    });
    expect(decision).toEqual({ ok: false, reason: 'client_mismatch' });
  });
});
