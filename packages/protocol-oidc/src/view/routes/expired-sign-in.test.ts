import { type PendingRequest } from '@odudu/authn-flows';
import Fastify, { type FastifyInstance } from 'fastify';
import { pathAddress } from '@odudu/kernel';
import { describe, expect, it, vi } from 'vitest';
import { sendSignInExpired } from '#/view/routes/expired-sign-in';
import { sendLoginOutcome, type LoginResponseDeps } from '#/view/routes/login-response';
import { type ContinuationDeps } from '#/view/routes/continuation';

const ADDRESS = pathAddress('https://idp.example', 'acme');

// These routes have no tenant segment, so the address is fixed.
function withAddress(app: FastifyInstance): FastifyInstance {
  app.decorateRequest('tenantAddress', { getter: () => ADDRESS });
  return app;
}

const PENDING: PendingRequest = {
  clientId: 'app',
  redirectUri: 'https://app.example/cb?keep=1',
  scope: 'openid',
  state: 's t&te',
  nonce: null,
  codeChallenge: 'c'.repeat(43),
  codeChallengeMethod: 'S256',
};

function deps(
  pending: PendingRequest | null,
  over: Partial<ContinuationDeps> = {},
): ContinuationDeps {
  return {
    findTenant: vi.fn().mockResolvedValue({ id: 't1' }),
    loadPendingRequest: vi.fn().mockResolvedValue(null),
    recoverPendingRequest: vi.fn().mockResolvedValue(pending),
    redirectStillRegistered: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

async function answer(d: ContinuationDeps, ...rest: [id?: string] | [undefined]) {
  const id = rest.length === 0 ? 'x' : rest[0];
  const app = withAddress(Fastify());
  app.get('/p', (_request, reply) => sendSignInExpired(reply, d, 'acme', id));
  return app.inject({ url: '/p', headers: { host: 'op.example' } });
}

describe('sendSignInExpired', () => {
  it('links to the authorize endpoint when the request can be rebuilt', async () => {
    const res = await answer(deps(PENDING));
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('>Start sign-in again</a>');
    expect(res.body).not.toContain('Return to the application');
  });

  it('hands a subject-bound request back to its client with access_denied, state and iss', async () => {
    const res = await answer(deps({ ...PENDING, idTokenHintSubject: 'sub-1' }));
    const href = /<a href="([^"]*)">Return to the application<\/a>/u.exec(res.body)?.[1];
    const back = new URL((href ?? '').replaceAll('&amp;', '&'));
    expect(back.origin + back.pathname).toBe('https://app.example/cb');
    expect(back.searchParams.get('keep')).toBe('1');
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('s t&te');
    expect(back.searchParams.get('iss')).toContain('/tenants/acme');
    expect(res.body).not.toContain('Start sign-in again');
  });

  it('omits state from the redirect when the request carried none', async () => {
    const res = await answer(deps({ ...PENDING, state: null, claimsSubject: 'sub-1' }));
    const href = /<a href="([^"]*)">Return/u.exec(res.body)?.[1] ?? '';
    expect(new URL(href.replaceAll('&amp;', '&')).searchParams.has('state')).toBe(false);
  });

  it('offers no way on once the client no longer registers the redirect_uri', async () => {
    const res = await answer(
      deps(
        { ...PENDING, idTokenHintSubject: 'sub-1' },
        { redirectStillRegistered: vi.fn().mockResolvedValue(false) },
      ),
    );
    expect(res.body).not.toContain('<a ');
  });

  it('offers nothing for no row, no id or no tenant', async () => {
    expect((await answer(deps(null))).body).not.toContain('<a ');
    expect((await answer(deps(PENDING), undefined)).body).not.toContain('<a ');
    const noTenant = deps(PENDING, { findTenant: vi.fn().mockResolvedValue(null) });
    expect((await answer(noTenant)).body).not.toContain('<a ');
  });
});

describe('the login outcome that resumes a parked login', () => {
  it('offers the same way on, since it answers through the same function', async () => {
    const d = { ...deps(PENDING) } as unknown as LoginResponseDeps;
    const app = withAddress(Fastify());
    app.get('/p', (_request, reply) =>
      sendLoginOutcome(reply, d, 'acme', { kind: 'unauthenticated' }, 'some-id'),
    );
    const res = await app.inject({ url: '/p' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('>Start sign-in again</a>');
  });
});
