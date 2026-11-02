import { expect, it } from 'vitest';
import { logOut } from '#/entities/session/adapter/logout';
import type { Auth, LogoutResult } from '#/shared/transport/auth';

function authAnswering(result: LogoutResult, calls: string[] = []): Auth {
  return {
    logout() {
      calls.push('logout');
      return Promise.resolve(result);
    },
  };
}

it('asks the transport to end the session, once, and returns its answer', async () => {
  const calls: string[] = [];
  const answer: LogoutResult = { ok: true, redirect: '/console/' };
  expect(await logOut(authAnswering(answer, calls))).toBe(answer);
  expect(calls).toEqual(['logout']);
});

it.each<LogoutResult>([
  { ok: false, kind: 'network' },
  { ok: false, kind: 'schema' },
  {
    ok: false,
    kind: 'problem',
    problem: { type: 'about:blank', title: 'Unauthorized', status: 401 },
  },
])('hands a refused sign-out back unchanged: $kind', async (answer) => {
  expect(await logOut(authAnswering(answer))).toBe(answer);
});
