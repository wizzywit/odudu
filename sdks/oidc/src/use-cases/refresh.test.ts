import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beginSignIn } from '#/use-cases/begin-sign-in';
import { completeSignIn } from '#/use-cases/complete-sign-in';
import { refresh } from '#/use-cases/refresh';
import { OduduError } from '#/services/odudu-error';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import type { SignInOptions, TokenSet } from '#/types';

const NOW = 1_800_000_000_000;
const deps = { allowInsecureRequests: true, now: () => NOW };
const REDIRECT = 'http://localhost:5173/callback';
let fake: FakeServer;

beforeEach(async () => {
  fake = await startFakeServer();
});
afterEach(async () => {
  await fake.close();
});

async function signedIn(extra: Partial<SignInOptions> = {}): Promise<TokenSet> {
  const { url, pending } = await beginSignIn(
    { issuer: fake.issuer, clientId: 'app-1', redirectUri: REDIRECT, scope: 'openid', ...extra },
    deps,
  );
  fake.claims = { nonce: pending.nonce };
  const callback = new URL(REDIRECT);
  callback.searchParams.set('code', 'code-1');
  callback.searchParams.set('state', new URL(url).searchParams.get('state') ?? '');
  callback.searchParams.set('iss', fake.issuer);
  const tokens = await completeSignIn(callback.href, pending, deps);
  fake.tokenRequests.length = 0;
  return tokens;
}

function refreshRequests(): URLSearchParams[] {
  return fake.tokenRequests.filter((form) => form.get('grant_type') === 'refresh_token');
}

describe('refresh', () => {
  it('ten concurrent refreshes make one token request', async () => {
    const tokens = await signedIn();
    const results = await Promise.all(Array.from({ length: 10 }, () => refresh(tokens, {}, deps)));
    expect(refreshRequests()).toHaveLength(1);
    expect(new Set(results.map((r) => r.refreshToken)).size).toBe(1);
  });

  it('concurrent refreshes with different resources never present the same refresh token twice', async () => {
    const a = 'https://a.example/api';
    const b = 'https://b.example/api';
    const tokens = await signedIn({ resource: [a, b] });
    const [first, second] = await Promise.all([
      refresh(tokens, { resource: a }, deps),
      refresh(tokens, { resource: b }, deps),
    ]);
    expect(refreshRequests().map((form) => form.get('refresh_token'))).toEqual([
      'refresh-token-1',
      'refresh-token-1-rotated',
    ]);
    expect(refreshRequests().map((form) => form.get('resource'))).toEqual([a, b]);
    expect(first.refreshToken).toBe('refresh-token-1-rotated');
    expect(second.refreshToken).toBe('refresh-token-1-rotated-rotated');
    expect(Object.keys(second.byAudience).sort()).toEqual([a, b]);
  });

  it('a waiter whose predecessor was refused uses the original refresh token', async () => {
    const a = 'https://a.example/api';
    const b = 'https://b.example/api';
    const tokens = await signedIn({ resource: [a, b] });
    fake.tokenError = { error: 'server_error' };
    const failing = refresh(tokens, { resource: a }, deps).catch(() => undefined);
    const waiting = refresh(tokens, { resource: b }, deps);
    await failing;
    fake.tokenError = undefined;
    await waiting;
    expect(refreshRequests().map((form) => form.get('refresh_token'))).toEqual([
      'refresh-token-1',
      'refresh-token-1',
    ]);
  });

  it('keeps the issuer and the client on the result', async () => {
    const tokens = await signedIn();
    const renewed = await refresh(tokens, {}, deps);
    expect(tokens.issuer).toBe(fake.issuer);
    expect(tokens.clientId).toBe('app-1');
    expect(renewed.issuer).toBe(fake.issuer);
    expect(renewed.clientId).toBe('app-1');
  });

  it('a refused refresh rejects every waiter with the same OduduError', async () => {
    const tokens = await signedIn();
    fake.tokenError = { error: 'invalid_grant', error_description: 'the token is spent' };
    const outcomes = await Promise.allSettled([
      refresh(tokens, {}, deps),
      refresh(tokens, {}, deps),
      refresh(tokens, {}, deps),
    ]);
    const reasons = outcomes.map((o) => (o.status === 'rejected' ? (o.reason as unknown) : null));
    expect(reasons[0]).toBeInstanceOf(OduduError);
    expect((reasons[0] as OduduError).code).toBe('invalid_grant');
    expect(reasons[1]).toBe(reasons[0]);
    expect(reasons[2]).toBe(reasons[0]);
    expect(refreshRequests()).toHaveLength(1);
  });

  it('names invalid_client when the refresh is refused with a challenge', async () => {
    const tokens = await signedIn();
    fake.tokenChallenge = true;
    fake.tokenError = { error: 'invalid_client' };
    const error = await refresh(tokens, {}, deps).catch((e: unknown) => e);
    expect((error as OduduError).code).toBe('invalid_client');
  });

  it('keeps request_failed for a challenge with no OAuth error body', async () => {
    const tokens = await signedIn();
    fake.tokenChallenge = true;
    const error = await refresh(tokens, {}, deps).catch((e: unknown) => e);
    expect((error as OduduError).code).toBe('request_failed');
  });

  it('drops the in-flight entry so a later refresh makes a new request', async () => {
    const tokens = await signedIn();
    fake.tokenError = { error: 'server_error' };
    await refresh(tokens, {}, deps).catch(() => undefined);
    fake.tokenError = undefined;
    await refresh(tokens, {}, deps);
    expect(refreshRequests()).toHaveLength(2);
  });

  it('a rotated refresh token replaces the old one in the result', async () => {
    const tokens = await signedIn();
    const renewed = await refresh(tokens, {}, deps);
    expect(tokens.refreshToken).toBe('refresh-token-1');
    expect(renewed.refreshToken).toBe('refresh-token-1-rotated');
    expect(refreshRequests()[0]?.get('refresh_token')).toBe('refresh-token-1');
    const again = await refresh(renewed, {}, deps);
    expect(refreshRequests()[1]?.get('refresh_token')).toBe('refresh-token-1-rotated');
    expect(again.refreshToken).toBe('refresh-token-1-rotated-rotated');
  });

  it('renews the access token under every audience it held', async () => {
    const tokens = await signedIn({ resource: ['https://a.example/api'] });
    fake.expiresIn = 60;
    const renewed = await refresh(tokens, {}, deps);
    expect(Object.keys(renewed.byAudience)).toEqual(['https://a.example/api']);
    expect(renewed.byAudience['https://a.example/api']?.expiresAt).toBe(NOW + 60_000);
    expect(refreshRequests()[0]?.has('resource')).toBe(false);
    expect(refreshRequests()[0]?.get('client_id')).toBe('app-1');
  });

  it('names a resource the grant carries and keeps the other audiences', async () => {
    const tokens = await signedIn({ resource: ['https://a.example/api', 'https://b.example/api'] });
    const renewed = await refresh(tokens, { resource: 'https://b.example/api' }, deps);
    expect(refreshRequests()[0]?.getAll('resource')).toEqual(['https://b.example/api']);
    expect(renewed.byAudience['https://b.example/api']?.accessToken).toBe('access-token-1');
    expect(renewed.byAudience['https://a.example/api']).toEqual(
      tokens.byAudience['https://a.example/api'],
    );
  });

  it('throws audience_not_granted when the grant lacks the resource', async () => {
    const tokens = await signedIn();
    fake.tokenError = { error: 'invalid_target', error_description: 'not available' };
    const error = await refresh(tokens, { resource: 'https://other.example/api' }, deps).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(OduduError);
    expect((error as OduduError).code).toBe('audience_not_granted');
    expect((error as OduduError).error).toBe('invalid_target');
    expect((error as OduduError).message).toContain('requestAudience');
  });

  it('a response without scope leaves the stored scope unchanged', async () => {
    const tokens = await signedIn({ resource: ['https://a.example/api'] });
    fake.scope = undefined;
    const renewed = await refresh(tokens, {}, deps);
    expect(renewed.byAudience['https://a.example/api']?.scope).toBe('openid');
  });

  it('a third call with the first resource arriving while the second flight runs queues behind it and uses the rotated token', async () => {
    const a = 'https://a.example/api';
    const b = 'https://b.example/api';
    const tokens = await signedIn({ resource: [a, b] });
    const calls = [
      refresh(tokens, { resource: a }, deps),
      refresh(tokens, { resource: b }, deps),
      refresh(tokens, { resource: a }, deps),
    ];
    const [, , third] = await Promise.all(calls);
    expect(refreshRequests().map((form) => form.get('refresh_token'))).toEqual([
      'refresh-token-1',
      'refresh-token-1-rotated',
      'refresh-token-1-rotated-rotated',
    ]);
    expect(refreshRequests().map((form) => form.get('resource'))).toEqual([a, b, a]);
    expect(third?.refreshToken).toBe('refresh-token-1-rotated-rotated-rotated');
  });

  it('refuses a refreshed ID token that names another subject', async () => {
    const tokens = await signedIn();
    fake.claims = { ...fake.claims, sub: 'someone-else' };
    const error = await refresh(tokens, {}, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OduduError);
    expect((error as OduduError).code).toBe('invalid_id_token');
  });

  it('accepts a refreshed ID token with the same subject', async () => {
    const tokens = await signedIn();
    const renewed = await refresh(tokens, {}, deps);
    expect(renewed.claims.sub).toBe(tokens.claims.sub);
  });

  it('refuses tokens that carry no refresh token', async () => {
    const tokens = await signedIn();
    const without: TokenSet = { ...tokens };
    delete without.refreshToken;
    const error = await refresh(without, {}, deps).catch((e: unknown) => e);
    expect((error as OduduError).code).toBe('invalid_options');
  });
});

describe('refresh against a server that revokes a family on reuse', () => {
  const a = 'https://a.example/api';
  const b = 'https://b.example/api';
  const c = 'https://c.example/api';

  it('a caller holding the rotated token queues behind the flight that uses it', async () => {
    const tokens = await signedIn({ resource: [a, b] });
    fake.tokenDelayMs = 30;
    const first = refresh(tokens, { resource: a }, deps);
    const second = refresh(tokens, { resource: b }, deps);
    const rotated = await first;
    const third = refresh(rotated, { resource: a }, deps);
    const results = await Promise.allSettled([second, third]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(fake.reuseDetections).toBe(0);
    expect(refreshRequests().map((form) => form.get('refresh_token'))).toEqual([
      'refresh-token-1',
      'refresh-token-1-rotated',
      'refresh-token-1-rotated-rotated',
    ]);
  });

  it('a call queued behind a refused flight continues from the last token that worked', async () => {
    const tokens = await signedIn({ resource: [a, b, c] });
    fake.refusedResource = b;
    const outcomes = await Promise.allSettled([
      refresh(tokens, { resource: a }, deps),
      refresh(tokens, { resource: b }, deps),
      refresh(tokens, { resource: c }, deps),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(fake.reuseDetections).toBe(0);
    expect(refreshRequests().map((form) => form.get('refresh_token'))).toEqual([
      'refresh-token-1',
      'refresh-token-1-rotated',
      'refresh-token-1-rotated',
    ]);
    const last = outcomes[2];
    expect(last.status === 'fulfilled' ? last.value.refreshToken : '').toBe(
      'refresh-token-1-rotated-rotated',
    );
  });

  it('makes exactly one request per rotation for mixed callers', async () => {
    const tokens = await signedIn({ resource: [a, b] });
    fake.tokenDelayMs = 20;
    const first = refresh(tokens, { resource: a }, deps);
    const sameFirst = refresh(tokens, { resource: a }, deps);
    const second = refresh(tokens, { resource: b }, deps);
    await Promise.all([first, sameFirst, second]);
    expect(refreshRequests()).toHaveLength(2);
    expect(fake.reuseDetections).toBe(0);
  });

  it('forgets a family once its calls have settled', async () => {
    const tokens = await signedIn({ resource: [a, b] });
    const rotated = await refresh(tokens, { resource: a }, deps);
    const again = await refresh(rotated, { resource: b }, deps);
    expect(fake.reuseDetections).toBe(0);
    expect(again.refreshToken).toBe('refresh-token-1-rotated-rotated');
  });
});
