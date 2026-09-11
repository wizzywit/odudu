import { type SubjectRecord } from '@odudu/domain-identity';
import { type ClientRecord } from '@odudu/domain-realm';
import { describe, expect, it } from 'vitest';
import { type TokenGrantRecord } from '#/schema/token-grants';
import { evaluateRefreshGrant, generateRefreshToken, hashRefreshToken } from '#/service/refresh';

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

const subject: SubjectRecord = {
  id: 'subject-1',
  realmId: 'realm-1',
  type: 'user',
  disabledAt: null,
};

const grant: TokenGrantRecord = {
  id: 'grant-1',
  realmId: 'realm-1',
  clientId: client.id,
  subjectId: subject.id,
  scope: 'openid profile',
  audience: ['https://api.example'],
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  revokedAt: null,
};

describe('generateRefreshToken / hashRefreshToken', () => {
  it('[RFC6749-10.4-02] produces a 43-character base64url token', () => {
    const token = generateRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes the same token identically and different tokens differently', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(hashRefreshToken(a)).toBe(hashRefreshToken(a));
    expect(hashRefreshToken(a)).not.toBe(hashRefreshToken(b));
  });
});

describe('evaluateRefreshGrant', () => {
  it('permits a matching client with no requested scope, keeping the original scope', () => {
    const decision = evaluateRefreshGrant(grant, client, subject, { requestedScope: '' });
    expect(decision).toEqual({ ok: true, scope: ['openid', 'profile'] });
  });

  it('refuses a grant issued to a different client', () => {
    const otherClient: ClientRecord = { ...client, id: 'client-2', clientId: 'other-app' };
    const decision = evaluateRefreshGrant(grant, otherClient, subject, { requestedScope: '' });
    expect(decision).toEqual({ ok: false, reason: 'client_mismatch' });
  });

  it('refuses an already-revoked grant', () => {
    const revoked: TokenGrantRecord = { ...grant, revokedAt: new Date() };
    const decision = evaluateRefreshGrant(revoked, client, subject, { requestedScope: '' });
    expect(decision).toEqual({ ok: false, reason: 'grant_revoked' });
  });

  it('refuses a disabled subject', () => {
    const disabled: SubjectRecord = { ...subject, disabledAt: new Date() };
    const decision = evaluateRefreshGrant(grant, client, disabled, { requestedScope: '' });
    expect(decision).toEqual({ ok: false, reason: 'subject_disabled' });
  });

  it('permits narrowing the requested scope', () => {
    const decision = evaluateRefreshGrant(grant, client, subject, { requestedScope: 'openid' });
    expect(decision).toEqual({ ok: true, scope: ['openid'] });
  });

  it('refuses widening the requested scope', () => {
    const decision = evaluateRefreshGrant(grant, client, subject, {
      requestedScope: 'openid profile admin',
    });
    expect(decision).toEqual({ ok: false, reason: 'scope_widened' });
  });

  it('checks client match before scope, so a wrong client is never reported as scope_widened', () => {
    const otherClient: ClientRecord = { ...client, id: 'client-2', clientId: 'other-app' };
    const decision = evaluateRefreshGrant(grant, otherClient, subject, {
      requestedScope: 'openid profile admin',
    });
    expect(decision).toEqual({ ok: false, reason: 'client_mismatch' });
  });
});
