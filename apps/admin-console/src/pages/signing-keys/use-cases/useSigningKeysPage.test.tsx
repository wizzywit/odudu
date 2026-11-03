import type { SigningKey } from '@odudu/contracts/admin';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it } from 'vitest';
import { SignedInContext } from '#/entities/session';
import { useSigningKeysPage } from '#/pages/signing-keys/use-cases/useSigningKeysPage';
import { json, problem } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import {
  ACTIVE_KEY,
  KEYS,
  keyRoutes,
  READY_KEY,
  RETIRED_KEY,
  YOUNG_KEY,
} from '#/testing/keysFixtures';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
});

const READY: SigningKey = {
  id: 'k-ready',
  status: 'rotating',
  kid: 'kid-k-ready',
  alg: 'ES256',
  created_at: '2026-10-01T00:00:00.000Z',
  not_after: null,
};

const GRACE = { tenant: 'acme', subjectId: 's1', username: 'grace' };

function page(extra: Parameters<typeof keyRoutes>[1] = {}, keys?: Parameters<typeof keyRoutes>[2]) {
  const harness = hookHarness(keyRoutes(undefined, extra, keys));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SignedInContext value={{ principal: GRACE, ended: null }}>
      <harness.wrapper>{children}</harness.wrapper>
    </SignedInContext>
  );
  return { ...harness, ...renderHook(() => useSigningKeysPage('acme'), { wrapper }) };
}

async function listed(result: { current: ReturnType<typeof useSigningKeysPage> }) {
  await waitFor(() => {
    expect(result.current.retired.status).toBe('ready');
    expect(result.current.active.status).toBe('ready');
    expect(result.current.rotating.status).toBe('ready');
  });
}

it('lists each status in its own lane, with readiness only on the rotating one', async () => {
  const { result } = page({}, [READY_KEY, YOUNG_KEY, ACTIVE_KEY, RETIRED_KEY]);
  await listed(result);
  expect(result.current.rotating.rows.map((row) => row.key.id)).toEqual(['k-ready', 'k-young']);
  expect(result.current.rotating.rows.map((row) => row.readiness?.ready)).toEqual([true, false]);
  expect(result.current.active.rows.map((row) => row.readiness)).toEqual([null]);
  expect(result.current.retired.rows.map((row) => row.readiness)).toEqual([null]);
});

it('asks before promoting and names the active key the promotion replaces', async () => {
  const { result, sent } = page();
  await listed(result);
  act(() => {
    result.current.ask('promote', READY);
  });
  expect(result.current.asking?.dialog.title).toBe('Promote this key?');
  expect(result.current.asking?.dialog.consequence).toContain('kid-k-active');
  expect(sent.some((call) => call.method === 'POST')).toBe(false);
  act(() => {
    result.current.cancel();
  });
  expect(result.current.asking).toBeNull();
});

it('promotes on confirm, with no body, and says what it came to', async () => {
  const promoted = { ...READY_KEY, status: 'active' };
  const { result, sent } = page({ [`POST ${KEYS}/k-ready/promote`]: json(promoted) });
  await listed(result);
  act(() => {
    result.current.ask('promote', READY);
  });
  await act(async () => {
    await result.current.confirm();
  });
  expect(sent.find((call) => call.method === 'POST')).toMatchObject({
    path: `${KEYS}/k-ready/promote`,
    body: undefined,
  });
  expect(result.current.notice).toBe('The ES256 key kid-k-ready is now the active key.');
});

it('stages the algorithm shown, which starts as the active key’s', async () => {
  const staged = { ...READY_KEY, id: 'k-new', alg: 'ES256' };
  const { result, sent } = page({ [`POST ${KEYS}`]: json(staged, 201) });
  await listed(result);
  expect(result.current.alg).toBe('ES256');
  act(() => {
    result.current.chooseAlg('RS256');
  });
  expect(result.current.alg).toBe('RS256');
  act(() => {
    result.current.stage();
  });
  await waitFor(() => {
    expect(sent.some((call) => call.method === 'POST')).toBe(true);
  });
  expect(sent.find((call) => call.method === 'POST')?.body).toEqual({ alg: 'RS256' });
});

it('names the capability a refused stage needed, beside the stage button', async () => {
  const { result } = page({ [`POST ${KEYS}`]: problem(403, 'about:blank', 'Forbidden') });
  await listed(result);
  act(() => {
    result.current.stage();
  });
  await waitFor(() => {
    expect(result.current.stageMessage).not.toBeNull();
  });
  expect(result.current.stageMessage).toContain('manage-keys');
});

// The one field the stage form has is not drawn, so a 400 that names only it
// leaves nothing to say: kept as it is, a stale rule if the form gains an error line.
it('says nothing when the server refuses the algorithm field alone', async () => {
  const { result, sent } = page({
    [`POST ${KEYS}`]: problem(400, 'about:blank', 'Bad Request', {
      detail: 'alg must be one of the algorithms this server signs with',
      errors: [{ path: 'alg', message: 'must be one of the algorithms this server signs with' }],
    }),
  });
  await listed(result);
  act(() => {
    result.current.stage();
  });
  await waitFor(() => {
    expect(sent.some((call) => call.method === 'POST')).toBe(true);
  });
  await waitFor(() => {
    expect(result.current.staging).toBe(false);
  });
  expect(result.current.stageMessage).toBeNull();
});

it('carries the title and the words the view shows', async () => {
  const { result } = page();
  await listed(result);
  expect(result.current.title).toBe('Signing keys');
  expect(result.current.words.lanes.map((lane) => lane.title)).toEqual([
    'Rotating',
    'Active',
    'Retired',
  ]);
  expect(result.current.words.stage.submit).toBe('Stage key');
  expect(result.current.rotating.rows[0]?.labels.promote).toBe('Promote kid-k-ready');
});
