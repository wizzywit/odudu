import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signOutUrl } from '#/use-cases/sign-out-url';
import { OduduError } from '#/services/odudu-error';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';

const deps = { allowInsecureRequests: true };
let fake: FakeServer;

beforeEach(async () => {
  fake = await startFakeServer();
});
afterEach(async () => {
  await fake.close();
});

describe('signOutUrl', () => {
  it('carries id_token_hint and post_logout_redirect_uri', async () => {
    const url = new URL(
      await signOutUrl(
        {
          issuer: fake.issuer,
          idToken: 'the.id.token',
          postLogoutRedirectUri: 'http://localhost:5173/',
          state: 'abc',
        },
        deps,
      ),
    );
    expect(`${url.origin}${url.pathname}`).toBe(`${fake.issuer}/logout`);
    expect(url.searchParams.get('id_token_hint')).toBe('the.id.token');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('http://localhost:5173/');
    expect(url.searchParams.get('state')).toBe('abc');
  });

  it('sends only the hint when nothing else is given', async () => {
    const url = new URL(await signOutUrl({ issuer: fake.issuer, idToken: 't' }, deps));
    expect([...url.searchParams.keys()]).toEqual(['id_token_hint']);
  });

  it('refuses a server with no end_session_endpoint', async () => {
    const fetcher = (): Promise<Response> =>
      Promise.resolve(
        Response.json({ issuer: 'https://nologout.example/t', token_endpoint: 'https://x/token' }),
      );
    const error = await signOutUrl(
      { issuer: 'https://nologout.example/t', idToken: 't' },
      { fetch: fetcher },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OduduError);
    expect((error as OduduError).code).toBe('discovery_failed');
  });
});
