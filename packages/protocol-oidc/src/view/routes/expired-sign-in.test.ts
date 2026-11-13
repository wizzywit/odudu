import { type PendingRequest } from '@odudu/authn-flows';
import Fastify, { type FastifyInstance } from 'fastify';
import { pathAddress } from '@odudu/kernel';
import { describe, expect, it, vi } from 'vitest';
import { sendActionUnavailable, sendSignInExpired } from '#/view/routes/expired-sign-in';
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

const backHref = (body: string): URL => {
  const href = /<a href="([^"]*)">Return to the application<\/a>/u.exec(body)?.[1] ?? '';
  return new URL(href.replaceAll('&amp;', '&'));
};

describe('a sign-in that expired under an action an application asked for', () => {
  const ASKED = { ...PENDING, idTokenHintSubject: 'sub-1', action: 'configure-totp' as const };

  it('tells the client the action did not complete', async () => {
    const res = await answer(deps(ASKED));
    expect(backHref(res.body).searchParams.get('action_status')).toBe('error');
  });

  it('says nothing of an action that already ended, or that was never asked', async () => {
    const ended = await answer(deps({ ...ASKED, actionStatus: 'success' }));
    expect(backHref(ended.body).searchParams.has('action_status')).toBe(false);
    const none = await answer(deps({ ...PENDING, idTokenHintSubject: 'sub-1' }));
    expect(backHref(none.body).searchParams.has('action_status')).toBe(false);
  });
});

describe('sendActionUnavailable', () => {
  async function unavailable(pending: PendingRequest | null) {
    const d = deps(null, { loadPendingRequest: vi.fn().mockResolvedValue(pending) });
    const app = withAddress(Fastify());
    app.get('/p', (_request, reply) => sendActionUnavailable(reply, d, 'acme', 'x'));
    return app.inject({ url: '/p', headers: { host: 'op.example' } });
  }

  it('says so and sends the person back with error, even for an action already ended', async () => {
    for (const status of [undefined, 'error'] as const) {
      const res = await unavailable({
        ...PENDING,
        action: 'generate-recovery-codes',
        ...(status === undefined ? {} : { actionStatus: status }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('This change is not available for your account.');
      const back = backHref(res.body);
      expect(back.searchParams.get('action_status')).toBe('error');
      expect(back.searchParams.get('error')).toBe('access_denied');
    }
  });

  it('offers no way back where the request is gone', async () => {
    expect((await unavailable(null)).body).not.toContain('<a ');
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
