import { describe, expect, it } from 'vitest';
import type { MeSessionAuth } from '#/repository/gate';
import type { MeCaller } from '#/usecase/admit-me';
import { requireFreshSignIn } from '#/usecase/freshness-gate';

const SESSION = '01a0a992-4657-7d89-8fbf-3385f54810d1';
const NOW = new Date('2026-11-11T10:00:00.000Z');
const ago = (seconds: number) => new Date(NOW.getTime() - seconds * 1000);

const CALLER: MeCaller = {
  tenantId: 'tenant-1',
  subjectId: 'subject-1',
  sessionId: SESSION,
  clientId: 'app',
  issuer: 'https://id.example.com/tenants/acme',
  freshnessSeconds: 300,
  usernameEditable: false,
  lifespans: {
    ssoSessionIdleSeconds: 1800,
    ssoSessionMaxSeconds: 36_000,
    rememberMeIdleSeconds: 604_800,
    rememberMeMaxSeconds: 2_592_000,
  },
};

function counting(signedInAt: Date | null): { sessionAuth: MeSessionAuth; reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    sessionAuth: {
      signedInAt: (tenantId, subjectId, sessionId) => {
        reads.push(`${tenantId} ${subjectId} ${sessionId}`);
        return Promise.resolve(signedInAt);
      },
    },
  };
}

const gate = (world: ReturnType<typeof counting>, caller: MeCaller, acr: string | null = null) =>
  requireFreshSignIn({ sessionAuth: world.sessionAuth, now: () => NOW }, caller, acr);

describe('requireFreshSignIn', () => {
  it('lets a request through on a sign-in inside the window', async () => {
    expect(await gate(counting(ago(10)), CALLER)).toEqual({ kind: 'fresh' });
  });

  it('lets a request through on a sign-in exactly at the window', async () => {
    expect(await gate(counting(ago(300)), CALLER)).toEqual({ kind: 'fresh' });
  });

  it('asks for a new sign-in once the window has passed, naming it', async () => {
    expect(await gate(counting(ago(301)), CALLER)).toEqual({
      kind: 'stale',
      challenge:
        'Bearer error="insufficient_user_authentication", ' +
        'error_description="A recent sign-in is required", max_age="300"',
    });
  });

  it('uses the tenant window, not a fixed one', async () => {
    const outcome = await gate(counting(ago(61)), { ...CALLER, freshnessSeconds: 60 });
    expect(outcome).toMatchObject({ kind: 'stale' });
    expect(outcome.kind === 'stale' && outcome.challenge).toContain('max_age="60"');
  });

  it('names the authentication context a route needs', async () => {
    const outcome = await gate(counting(ago(999)), CALLER, '2');
    expect(outcome.kind === 'stale' && outcome.challenge).toContain(', acr_values="2"');
  });

  it('refuses plainly when the session behind the token is gone, with no way to refresh it', async () => {
    expect(await gate(counting(null), CALLER)).toEqual({
      kind: 'unauthenticated',
      challenge: 'Bearer error="invalid_token"',
    });
  });

  it('refuses plainly, without a read, when the token has no session', async () => {
    const world = counting(ago(1));
    expect(await gate(world, { ...CALLER, sessionId: null })).toEqual({
      kind: 'unauthenticated',
      challenge: 'Bearer error="invalid_token"',
    });
    expect(world.reads).toEqual([]);
  });

  it('refuses plainly, without a read, when the token names no session id at all', async () => {
    const world = counting(ago(1));
    expect(await gate(world, { ...CALLER, sessionId: 'not-a-uuid' })).toMatchObject({
      kind: 'unauthenticated',
    });
    expect(world.reads).toEqual([]);
  });

  it('reads the session once, for the token’s own subject in its tenant', async () => {
    const world = counting(ago(10));
    await gate(world, CALLER);
    expect(world.reads).toEqual([`tenant-1 subject-1 ${SESSION}`]);
  });
});
