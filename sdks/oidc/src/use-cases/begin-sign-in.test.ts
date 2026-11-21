import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { beginSignIn } from '#/use-cases/begin-sign-in';
import { buildAuthorizationRequest } from '#/repository/authorization-request';
import { discover } from '#/use-cases/discover';
import { OduduError } from '#/services/odudu-error';
import { startFakeServer, type FakeServer } from '#/testing/fake-server';
import type { SignInOptions } from '#/types';

const HTTP = { allowInsecureRequests: true };
let fake: FakeServer;

beforeEach(async () => {
  fake = await startFakeServer();
});
afterEach(async () => {
  await fake.close();
});

function options(extra: Partial<SignInOptions> = {}): SignInOptions {
  return {
    issuer: fake.issuer,
    clientId: 'app-1',
    redirectUri: 'http://localhost:5173/callback',
    scope: 'openid profile',
    ...extra,
  };
}

describe('beginSignIn', () => {
  it('sends S256, state and nonce and prompt=create', async () => {
    const { url, pending } = await beginSignIn(options({ prompt: 'create' }), HTTP);
    const target = new URL(url);
    expect(`${target.origin}${target.pathname}`).toBe(`${fake.issuer}/authorize`);
    const params = target.searchParams;
    expect(params.get('response_type')).toBe('code');
    expect(params.get('client_id')).toBe('app-1');
    expect(params.get('redirect_uri')).toBe('http://localhost:5173/callback');
    expect(params.get('scope')).toBe('openid profile');
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toBe(
      createHash('sha256').update(pending.codeVerifier).digest('base64url'),
    );
    expect(params.get('state')).toBe(pending.state);
    expect(params.get('nonce')).toBe(pending.nonce);
    expect(params.get('prompt')).toBe('create');
    expect(params.has('action')).toBe(false);
    expect(params.has('login_hint')).toBe(false);
  });

  it('with action sends action and no prompt', async () => {
    const { url } = await beginSignIn(options({ action: 'update-password' }), HTTP);
    const params = new URL(url).searchParams;
    expect(params.get('action')).toBe('update-password');
    expect(params.has('prompt')).toBe(false);
  });

  it('refuses a prompt and an action together', async () => {
    const both = { prompt: 'create', action: 'configure-totp' } as unknown as SignInOptions;
    const error = await beginSignIn(options(both), HTTP).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OduduError);
    expect((error as OduduError).code).toBe('invalid_options');
  });

  it('makes a fresh state, nonce and verifier every time', async () => {
    const first = await beginSignIn(options(), HTTP);
    const second = await beginSignIn(options(), HTTP);
    expect(second.pending.state).not.toBe(first.pending.state);
    expect(second.pending.nonce).not.toBe(first.pending.nonce);
    expect(second.pending.codeVerifier).not.toBe(first.pending.codeVerifier);
  });

  it('adds openid when the scope lacks it', async () => {
    const { url } = await beginSignIn(options({ scope: 'profile' }), HTTP);
    expect(new URL(url).searchParams.get('scope')).toBe('openid profile');
  });

  it('asks for the me audience and me:read for read access', async () => {
    const { url, pending } = await beginSignIn(options({ meAccess: 'read' }), HTTP);
    const params = new URL(url).searchParams;
    expect(params.getAll('resource')).toEqual([`${fake.issuer}/me`]);
    expect(params.get('scope')?.split(' ')).toEqual(['openid', 'profile', 'me:read']);
    expect(pending.resources).toEqual([`${fake.issuer}/me`]);
  });

  it('asks for me:read and me:write for write access', async () => {
    const { url } = await beginSignIn(
      options({ meAccess: 'write', resource: ['https://api.example'] }),
      HTTP,
    );
    const params = new URL(url).searchParams;
    expect(params.getAll('resource')).toEqual(['https://api.example', `${fake.issuer}/me`]);
    expect(params.get('scope')?.split(' ')).toEqual(['openid', 'profile', 'me:read', 'me:write']);
  });

  it('returns a pending record that survives JSON', async () => {
    const { pending } = await beginSignIn(options(), HTTP);
    expect(JSON.parse(JSON.stringify(pending))).toEqual(pending);
  });

  it('reads the options once, so changing them mid-call cannot split the address from the record', async () => {
    const metadata = await discover(fake.issuer, HTTP);
    const given: SignInOptions = options({ prompt: 'create' });
    const started = buildAuthorizationRequest(metadata, given);
    const changeable = given as { redirectUri: string; prompt?: 'create' };
    changeable.redirectUri = 'http://localhost:5173/other';
    delete changeable.prompt;
    const { url, pending } = await started;
    expect(new URL(url).searchParams.get('redirect_uri')).toBe('http://localhost:5173/callback');
    expect(new URL(url).searchParams.get('prompt')).toBe('create');
    expect(pending.redirectUri).toBe('http://localhost:5173/callback');
  });

  it('copies the nested arrays too, so changing resource mid-call changes nothing', async () => {
    const metadata = await discover(fake.issuer, HTTP);
    const given = options({ resource: ['https://a.example/api'] });
    const started = buildAuthorizationRequest(metadata, given);
    given.resource?.push('https://evil.example/api');
    const { url, pending } = await started;
    expect(new URL(url).searchParams.getAll('resource')).toEqual(['https://a.example/api']);
    expect(pending.resources).toEqual(['https://a.example/api']);
  });
});
