import formbody from '@fastify/formbody';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { configureTenantAddress } from '#/view/issuer';
import {
  registerRequiredActionRoute,
  type RequiredActionRouteDeps,
} from '#/view/routes/required-action';

const SESSION = '01a0a998-8326-7900-8fa6-dd06b842b269';
const tenant = {
  id: 't1',
  enabled: true,
  supportedLocales: ['en'],
  defaultLocale: null,
  passwordRules: {
    minLength: 15,
    requireDigit: false,
    requireUppercase: false,
    requireLowercase: false,
    requireSpecial: false,
  },
};

function route(beginRecoveryCodes: ReturnType<typeof vi.fn>) {
  const completeRecoveryCodes = vi.fn().mockResolvedValue({ kind: 'acknowledged' });
  const deps = {
    findTenant: vi.fn().mockResolvedValue(tenant),
    authenticatedSubject: vi.fn().mockResolvedValue('s1'),
    pendingActions: vi.fn().mockResolvedValue(['generate-recovery-codes']),
    loadPendingRequest: vi.fn().mockResolvedValue(null),
    recoverPendingRequest: vi.fn().mockResolvedValue(null),
    redirectStillRegistered: vi.fn().mockResolvedValue(true),
    recordActionStep: vi.fn().mockResolvedValue(undefined),
    beginRecoveryCodes,
    completeRecoveryCodes,
  } as unknown as RequiredActionRouteDeps;
  return { deps, completeRecoveryCodes };
}

async function post(deps: RequiredActionRouteDeps, fields: Record<string, string>) {
  const app = Fastify();
  configureTenantAddress(app);
  await app.register(formbody);
  registerRequiredActionRoute(app, deps);
  await app.ready();
  const res = await app.inject({
    method: 'POST',
    url: '/tenants/acme/login-actions/required-action?action=generate-recovery-codes',
    payload: new URLSearchParams({ auth_session_id: SESSION, ...fields }).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  });
  await app.close();
  return res;
}

describe('asking again for the recovery codes the sign-in waits for', () => {
  it('says how many seconds remain, and acknowledges nothing', async () => {
    const begin = vi.fn().mockResolvedValue({
      kind: 'too_soon',
      retryAt: new Date(),
      retryInMinutes: 1,
      retryInSeconds: 12,
    });
    const { deps, completeRecoveryCodes } = route(begin);

    const res = await post(deps, { confirm: '1' });

    expect(res.statusCode).toBe(429);
    expect(res.body).toContain('12 seconds');
    expect(res.body).toContain('name="confirm" value="1"');
    expect(begin).toHaveBeenCalledTimes(1);
    expect(completeRecoveryCodes).not.toHaveBeenCalled();
  });

  it('shows the new set once the wait is over', async () => {
    const begin = vi
      .fn()
      .mockResolvedValue({ kind: 'issued', offer: { codes: ['abcd-1234'], replaced: true } });
    const { deps, completeRecoveryCodes } = route(begin);

    const res = await post(deps, { confirm: '1' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('abcd-1234');
    expect(completeRecoveryCodes).not.toHaveBeenCalled();
  });
});
