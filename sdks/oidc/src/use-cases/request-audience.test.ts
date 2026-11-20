import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { completeSignIn } from '#/use-cases/complete-sign-in';
import { requestAudience } from '#/use-cases/request-audience';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';

const deps = { allowInsecureRequests: true, now: () => 1_800_000_000_000 };
const REDIRECT = 'http://localhost:5173/callback';
let fake: FakeServer;

beforeEach(async () => {
  fake = await startFakeServer();
});
afterEach(async () => {
  await fake.close();
});

const base = () => ({ issuer: fake.issuer, clientId: 'app-1', redirectUri: REDIRECT });

describe('requestAudience', () => {
  it('asks for the me audience and the scope that reads it', async () => {
    const { url, pending } = await requestAudience(
      { ...base(), scope: 'openid', resource: `${fake.issuer}/me` },
      deps,
    );
    const params = new URL(url).searchParams;
    expect(params.getAll('resource')).toEqual([`${fake.issuer}/me`]);
    expect(params.get('scope')?.split(' ')).toContain('me:read');
    expect(params.has('prompt')).toBe(false);
    expect(pending.resources).toEqual([`${fake.issuer}/me`]);
  });

  it('completing it yields a token for the me audience', async () => {
    const { url, pending } = await requestAudience(
      { ...base(), scope: 'openid', resource: `${fake.issuer}/me` },
      deps,
    );
    fake.claims = { nonce: pending.nonce };
    fake.scope = 'openid me:read';
    const callback = new URL(REDIRECT);
    callback.searchParams.set('code', 'code-2');
    callback.searchParams.set('state', new URL(url).searchParams.get('state') ?? '');
    callback.searchParams.set('iss', fake.issuer);
    const tokens = await completeSignIn(callback.href, pending, deps);
    expect(Object.keys(tokens.byAudience)).toEqual([`${fake.issuer}/me`]);
    expect(tokens.byAudience[`${fake.issuer}/me`]?.scope).toBe('openid me:read');
  });

  it('asks for any other audience as given, without a me scope', async () => {
    const { url } = await requestAudience(
      { ...base(), scope: 'openid orders:read', resource: 'https://a.example/api' },
      deps,
    );
    const params = new URL(url).searchParams;
    expect(params.getAll('resource')).toEqual(['https://a.example/api']);
    expect(params.get('scope')).toBe('openid orders:read');
  });

  it('sets prompt=none only when silent is asked for', async () => {
    const { url } = await requestAudience(
      { ...base(), scope: 'openid', resource: 'https://a.example/api', silent: true },
      deps,
    );
    expect(new URL(url).searchParams.get('prompt')).toBe('none');
  });
});
