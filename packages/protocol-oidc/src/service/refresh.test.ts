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

// The other half of RFC6749-10.10-02; see the note on the authorization
// code's describe in service/authorization-code.test.ts.
describe('[RFC6749-10.10-02] generateRefreshToken', () => {
  // 43 base64url characters is 32 bytes, which is 256 bits — past the 2^-128
  // §10.10 requires and the 2^-160 it recommends. The same property is
  // asserted again under RFC6749-10.4-02 below rather than borrowed from
  // here: a row is only held by the tests that carry its own id, and the
  // trace tool reads the innermost id in a test's full name, so an `it`
  // nested here under a different id would leave this row holding the two
  // sampling assertions alone — neither of which tells 64 bits from 256.
  it('produces a 43-character base64url token, which is 32 bytes wide', () => {
    const token = generateRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  // Width is not entropy: 8 random bytes padded out to 43 characters decode
  // to 32 bytes and satisfy the assertion above. Structure is what a guesser
  // exploits — a fixed prefix, padding, an embedded constant, a counter in a
  // known position — and every one of those shows up as a character position
  // that never varies, so every position is checked across a sample.
  it('varies at every character position across a sample', () => {
    const tokens = Array.from({ length: 256 }, () => generateRefreshToken());
    const constant = Array.from({ length: 43 }, (_unused, i) => i).filter(
      (i) => new Set(tokens.map((token) => token[i])).size === 1,
    );
    expect(constant).toEqual([]);
  });

  it('produces no repeat across a large sample', () => {
    const sample = new Set(Array.from({ length: 5_000 }, () => generateRefreshToken()));
    expect(sample.size).toBe(5_000);
  });
});

// §10.4's "cannot be generated, modified, or guessed by unauthorized
// parties", for the three verbs separately: guessing is the width and the
// randomness behind it, generating is what possession of the store does not
// buy, and modifying is what happens to a token that is looked up by digest.
describe('[RFC6749-10.4-02] a refresh token cannot be generated, modified or guessed', () => {
  it('is 32 bytes wide, so guessing one is a 2^-256 proposition', () => {
    const token = generateRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('hashes the same token identically and different tokens differently', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(hashRefreshToken(a)).toBe(hashRefreshToken(a));
    expect(hashRefreshToken(a)).not.toBe(hashRefreshToken(b));
  });

  // A SHA-256 digest, base64url-encoded, is 43 characters — the same shape
  // as the token itself. So a stolen row *looks* like a presentable token,
  // and the only thing making it useless is that presenting it hashes it
  // again, to something the store does not hold.
  it('stores a digest that is not itself a working token', () => {
    const token = generateRefreshToken();
    const stored = hashRefreshToken(token);
    expect(stored).not.toBe(token);
    expect(hashRefreshToken(stored)).not.toBe(stored);
  });

  // Refresh tokens are looked up by digest, so tampering does not have to be
  // detected — it has to be unsurvivable. Every one-character edit of a
  // token must hash to something no row holds, and a digest that ignored
  // part of its input (a truncating or prefix-only hash) would not.
  it('gives every single-character edit of a token a different digest', () => {
    const token = generateRefreshToken();
    const stored = hashRefreshToken(token);
    const edits = Array.from({ length: token.length }, (_unused, i) => {
      const replacement = token[i] === 'A' ? 'B' : 'A';
      return `${token.slice(0, i)}${replacement}${token.slice(i + 1)}`;
    });

    const collisions = edits.filter((edit) => hashRefreshToken(edit) === stored);
    expect(collisions).toEqual([]);
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
