import { describe, expect, it } from 'vitest';
import type { GatewayResult, Problem } from '#/shared/service/result.ts';
import {
  bootOf,
  draftOwner,
  isReplacement,
  sessionGone,
  shownPrincipal,
  sessionEndedRead,
  type SessionRead,
} from '#/features/session/service/boot.ts';
import { type Principal } from '#/features/session/service/address.ts';

const grace: Principal = { tenant: 'acme', subjectId: 's1', username: 'grace' };

const ada: Principal = { tenant: 'acme', subjectId: 's2', username: 'ada' };

function problem(
  status: number,
  type = 'about:blank',
): { ok: false; kind: 'problem'; problem: Problem } {
  const body: Problem = { type, title: 'Problem', status };
  return { ok: false, kind: 'problem', problem: body };
}

function read(result: GatewayResult<Principal>, was: Principal | null = null): SessionRead {
  return { result, was };
}

function ok(principal: Principal): GatewayResult<Principal> {
  return { ok: true, status: 200, data: principal, etag: null, next: null };
}

it('keys drafts by the administrator and the tenant they signed in to', () => {
  expect(draftOwner({ tenant: 'acme', subjectId: 's1', username: 'grace' })).toBe('acme/s1');
});

describe('the principal a tab shows', () => {
  it('is the one read, or the one shown before a replacement was read', () => {
    expect(shownPrincipal(undefined)).toBeNull();
    expect(shownPrincipal(read(problem(401)))).toBeNull();
    expect(shownPrincipal(read(ok(grace)))).toBe(grace);
    expect(shownPrincipal(read(ok(ada), grace))).toBe(grace);
  });
});

describe('how a session read boots the console', () => {
  it('is loading until the read answers', () => {
    expect(bootOf(undefined)).toEqual({ kind: 'loading' });
  });

  it('is ready with the principal when the read names one', () => {
    expect(bootOf(read(ok(grace)))).toEqual({ kind: 'ready', principal: grace, ended: null });
  });

  it('names both principals when another tab signed somebody else in', () => {
    expect(bootOf(read(ok(ada), grace))).toEqual({ kind: 'replaced', was: grace, now: ada });
  });

  it('is ready with nobody, and whose session it was, when the gateway says it ended', () => {
    const ended = problem(401, 'about:blank#console-session-ended');
    expect(bootOf(read(ended, grace))).toEqual({ kind: 'ready', principal: null, ended: grace });
    expect(bootOf(read(ended))).toEqual({ kind: 'ready', principal: null, ended: null });
  });

  it('fails on a plain 401, any other problem, and a lost answer', () => {
    expect(bootOf(read(problem(401)))).toEqual({ kind: 'failed' });
    expect(bootOf(read(problem(500)))).toEqual({ kind: 'failed' });
    expect(bootOf(read({ ok: false, kind: 'network' }))).toEqual({ kind: 'failed' });
  });
});

describe('what a fresh session read means for the tab', () => {
  it('is no replacement when the principal and tenant are the ones shown', () => {
    expect(isReplacement(grace, { ...grace, username: 'renamed' })).toBe(false);
  });

  it('is a replacement when the subject or the tenant differs', () => {
    expect(isReplacement(grace, ada)).toBe(true);
    expect(isReplacement(grace, { ...grace, tenant: 'other' })).toBe(true);
  });
});

describe('whether a sign-out answer means the session is gone', () => {
  it('is yes for a sign-out, an answer that could not be read, and a session already over', () => {
    expect(sessionGone({ ok: true, redirect: '/console/' })).toBe(true);
    expect(sessionGone({ ok: false, kind: 'schema' })).toBe(true);
    expect(sessionGone(problem(401, 'about:blank#console-session-ended'))).toBe(true);
  });

  it('is no for any other failure', () => {
    expect(sessionGone(problem(401))).toBe(false);
    expect(sessionGone(problem(500))).toBe(false);
    expect(sessionGone({ ok: false, kind: 'network' })).toBe(false);
  });
});

describe('the read a tab holds once its session ended', () => {
  it('is the gateway session-ended 401, which boots to nobody', () => {
    expect(bootOf({ result: sessionEndedRead(), was: grace })).toEqual({
      kind: 'ready',
      principal: null,
      ended: grace,
    });
    expect(sessionEndedRead()).toEqual({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank#console-session-ended', title: 'Unauthorized', status: 401 },
    });
  });
});
