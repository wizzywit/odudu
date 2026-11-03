import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useTenantDeletion } from '#/pages/tenants/repository/useTenantDeletion';
import { pending, problem } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { ADMIN } from '#/testing/tenantsFixtures';

const path = `DELETE ${ADMIN}/acme`;
const gone = () => new Response(null, { status: 204 });

const HELD = [
  ['list', 'acme', 'subjects'],
  ['authority', 'acme', null],
  ['record', 'system', 'tenants/acme'],
] as const;
const KEPT = [
  ['list', 'acme-eu', 'subjects'],
  ['record', 'system', 'tenants/acme-eu'],
] as const;
const STALE = [
  ['list', 'system', 'tenants'],
  ['count', 'system', 'tenants', ''],
  ['list', 'system', 'audit'],
  ['overview', 'system', 'tenants'],
] as const;

it('deletes the tenant and reads the system lists of tenants, counts, audit and overview again', async () => {
  const { wrapper, queryClient, sent } = hookHarness({ [path]: gone });
  for (const key of STALE) queryClient.setQueryData(key, 'held');
  const { result } = renderHook(() => useTenantDeletion('acme'), { wrapper });
  let answer: Awaited<ReturnType<typeof result.current.run>> | undefined;
  await act(async () => {
    answer = await result.current.run();
  });
  expect(answer?.ok).toBe(true);
  expect(sent.map((s) => [s.method, s.search.toString()])).toEqual([['DELETE', 'confirm=acme']]);
  expect(STALE.map((key) => queryClient.getQueryState(key)?.isInvalidated)).toEqual([
    true,
    true,
    true,
    true,
  ]);
});

it('is busy from the press until the server answers', async () => {
  const { wrapper } = hookHarness({ [path]: pending() });
  const { result } = renderHook(() => useTenantDeletion('acme'), { wrapper });
  expect(result.current.busy).toBe(false);
  act(() => {
    result.current.run().catch(() => undefined);
  });
  await waitFor(() => {
    expect(result.current.busy).toBe(true);
  });
});

it('reads only the tenant’s own record again when the server refuses, and answers the refusal', async () => {
  const { wrapper, queryClient } = hookHarness({
    [path]: problem(409, 'about:blank#tenant-enabled', 'Conflict'),
  });
  const held = [...HELD, ...STALE];
  for (const key of held) queryClient.setQueryData(key, 'held');
  const { result, unmount } = renderHook(() => useTenantDeletion('acme'), { wrapper });
  let answer: Awaited<ReturnType<typeof result.current.run>> | undefined;
  await act(async () => {
    answer = await result.current.run();
  });
  expect(answer?.ok).toBe(false);
  unmount();
  expect(
    held.map((key) => [key.join('/'), queryClient.getQueryState(key)?.isInvalidated === true]),
  ).toEqual(held.map((key) => [key.join('/'), key.join('/') === 'record/system/tenants/acme']));
});

it('counts a tenant already gone as deleted, and drops its entries once the page is left', async () => {
  const { wrapper, queryClient } = hookHarness({
    [path]: problem(404, 'about:blank', 'Not Found'),
  });
  const { result, unmount } = renderHook(() => useTenantDeletion('acme'), { wrapper });
  let answer: Awaited<ReturnType<typeof result.current.run>> | undefined;
  await act(async () => {
    answer = await result.current.run();
  });
  expect(answer?.ok).toBe(true);
  unmount();
  expect(queryClient.getQueryCache().getAll()).toEqual([]);
});

it("keeps its entries while the page is open, and drops only the deleted tenant's once it is left", async () => {
  const { wrapper, queryClient } = hookHarness({ [path]: gone });
  for (const key of [...HELD, ...KEPT]) queryClient.setQueryData(key, 'held');
  const { result, unmount } = renderHook(() => useTenantDeletion('acme'), { wrapper });
  await act(async () => {
    await result.current.run();
  });
  expect(HELD.map((key) => queryClient.getQueryData(key))).toEqual(['held', 'held', 'held']);
  unmount();
  expect(HELD.map((key) => queryClient.getQueryData(key))).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect(KEPT.map((key) => queryClient.getQueryData(key))).toEqual(['held', 'held']);
});
