import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useRevokeAgent, useRevokeCount } from '#/pages/agents/repository/useAgents';
import { RUN_ROOT } from '#/testing/agentsFixtures';
import { inTurn, json, pending, problem } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import type { AgentInstance } from '#/pages/agents/types/agent';

const path = 'DELETE /console/api/admin/tenants/acme/agents/run-root';

const RUN: AgentInstance = {
  id: 'run-root',
  owner: RUN_ROOT.owner,
  agentClient: RUN_ROOT.agent_client,
  parent: null,
  depth: 1,
  state: 'live',
  scope: RUN_ROOT.scope,
  createdAt: RUN_ROOT.created_at,
  expiresAt: RUN_ROOT.expires_at,
  revokedAt: null,
  budget: { mutating: 18, creates: 9 },
};

it('revokes a run and reads every list of the tenant and every run read on its own again', async () => {
  const { wrapper, invalidated } = hookHarness({ [path]: json({ grants: 2, instances: 3 }) });
  const { result } = renderHook(() => useRevokeAgent('acme'), { wrapper });
  let answer: Awaited<ReturnType<typeof result.current.run>> | undefined;
  await act(async () => {
    answer = await result.current.run(RUN);
  });
  expect(answer).toMatchObject({ ok: true, data: { grants: 2, instances: 3 } });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['list', 'acme'] });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['count', 'acme'] });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['agent', 'acme'] });
});

it('reads them again when the server refused as well, since the answer says nothing of what held', async () => {
  const { wrapper, invalidated } = hookHarness({
    [path]: problem(403, 'about:blank', 'Forbidden'),
  });
  const { result } = renderHook(() => useRevokeAgent('acme'), { wrapper });
  let answer: Awaited<ReturnType<typeof result.current.run>> | undefined;
  await act(async () => {
    answer = await result.current.run(RUN);
  });
  expect(answer?.ok).toBe(false);
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['list', 'acme'] });
});

it('is busy from the press until the server answers', async () => {
  const { wrapper } = hookHarness({ [path]: pending() });
  const { result } = renderHook(() => useRevokeAgent('acme'), { wrapper });
  expect(result.current.busy).toBe(false);
  act(() => {
    result.current.run(RUN).catch(() => undefined);
  });
  await waitFor(() => {
    expect(result.current.busy).toBe(true);
  });
});

it('counts what a revoke would end with dry_run, and only once it is asked', async () => {
  const { wrapper, sent } = hookHarness({ [path]: json({ grants: 1, instances: 2 }) });
  const { result, rerender } = renderHook(
    ({ asked }) => useRevokeCount('acme', 'run-root', asked),
    { wrapper, initialProps: { asked: false } },
  );
  expect(result.current.status).toBe('loading');
  expect(sent).toHaveLength(0);
  rerender({ asked: true });
  await waitFor(() => {
    expect(result.current).toEqual({ status: 'ready', data: { grants: 1, instances: 2 } });
  });
  expect(sent.map((request) => request.search.get('dry_run'))).toEqual(['true']);
});

it('never answers a count it read for an earlier ask: reopened, it is loading until the server says again', async () => {
  const { wrapper } = hookHarness({
    [path]: inTurn(json({ grants: 1, instances: 1 }), json({ grants: 2, instances: 3 })),
  });
  const { result, rerender } = renderHook(
    ({ asked }) => useRevokeCount('acme', 'run-root', asked),
    { wrapper, initialProps: { asked: true } },
  );
  await waitFor(() => {
    expect(result.current).toEqual({ status: 'ready', data: { grants: 1, instances: 1 } });
  });
  rerender({ asked: false });
  expect(result.current.status).toBe('loading');
  rerender({ asked: true });
  expect(result.current.status).toBe('loading');
  await waitFor(() => {
    expect(result.current).toEqual({ status: 'ready', data: { grants: 2, instances: 3 } });
  });
});
