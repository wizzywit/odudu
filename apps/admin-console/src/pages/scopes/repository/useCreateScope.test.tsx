import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useCopySource, useCreateScope } from '#/pages/scopes/repository/useCreateScope';
import { json, problem } from '#/testing/fakeTransport';
import { hookHarness, rejectingTransport } from '#/testing/hookHarness';
import { MAPPED, SC, scope } from '#/testing/scopesFixtures';

it('reads the lists and pickers that show it again once it is created, and not when it is refused', async () => {
  const { wrapper, invalidated } = hookHarness({
    [`POST ${SC}`]: json(scope('s-new', 'invoices'), 201),
  });
  const { result } = renderHook(() => useCreateScope('acme'), { wrapper });
  await act(async () => {
    await result.current.create({ name: 'invoices', description: '' });
  });
  for (const kind of ['list', 'count', 'picker']) {
    expect(invalidated).toHaveBeenCalledWith({ queryKey: [kind, 'acme', 'scopes'] });
  }
});

it('reads nothing again when the creation was refused', async () => {
  const { wrapper, invalidated } = hookHarness({});
  const { result } = renderHook(() => useCreateScope('acme'), { wrapper });
  await act(async () => {
    await result.current.create({ name: 'invoices', description: '' });
  });
  expect(invalidated).not.toHaveBeenCalled();
});

const S1 = `${SC}/s1`;
const READS = {
  [`GET ${S1}`]: json(scope('s1', 'billing')),
  [`GET ${S1}/roles`]: json({ items: [MAPPED] }, 200, { etag: '"r1"' }),
  [`GET ${S1}/mappers`]: json({ available: ['email'], bound: ['email'], declared: [] }, 200, {
    etag: '"m1"',
  }),
};

it('reads the scope to copy with the roles it maps and the mappers it binds', async () => {
  const { wrapper } = hookHarness(READS);
  const { result } = renderHook(() => useCopySource('acme', 's1'), { wrapper });
  expect(result.current).toEqual({ status: 'loading' });
  await waitFor(() => {
    expect(result.current.status).toBe('ready');
  });
  expect(result.current).toMatchObject({
    scope: { name: 'billing' },
    roles: [MAPPED],
    bound: ['email'],
  });
});

it('has nothing to read without a scope to copy', () => {
  const { wrapper } = hookHarness(READS);
  const { result } = renderHook(() => useCopySource('acme', null), { wrapper });
  expect(result.current).toEqual({ status: 'none' });
});

it('says the copy could not be read when any of its three reads failed', async () => {
  const { wrapper } = hookHarness({ ...READS, [`GET ${S1}/mappers`]: problem(500) });
  const { result } = renderHook(() => useCopySource('acme', 's1'), { wrapper });
  await waitFor(() => {
    expect(result.current).toEqual({ status: 'failed' });
  });
});

it('says the copy could not be read when a read threw', async () => {
  const { wrapper } = hookHarness({}, rejectingTransport());
  const { result } = renderHook(() => useCopySource('acme', 's1'), { wrapper });
  await waitFor(() => {
    expect(result.current).toEqual({ status: 'failed' });
  });
});

const PUTS = {
  [`PUT ${S1}/roles`]: json({ items: [MAPPED] }),
  [`PUT ${S1}/mappers`]: json({ available: ['email'], bound: ['email'], declared: [] }),
};

it('maps the roles and binds the mappers, each on the tag its own read answered', async () => {
  const { wrapper, sent } = hookHarness({ ...READS, ...PUTS });
  const { result } = renderHook(() => useCreateScope('acme'), { wrapper });
  let missed: readonly string[] = ['unset'];
  await act(async () => {
    missed = await result.current.fill('s1', ['r-aud'], ['email']);
  });
  expect(missed).toEqual([]);
  const writes = sent.filter((request) => request.method === 'PUT');
  expect(writes.map((request) => [request.path, request.ifMatch, request.body])).toEqual([
    [`${S1}/roles`, '"r1"', { role_ids: ['r-aud'] }],
    [`${S1}/mappers`, '"m1"', { mapper_names: ['email'] }],
  ]);
});

it('asks nothing for a part there is nothing to put in', async () => {
  const { wrapper, sent } = hookHarness({ ...READS, ...PUTS });
  const { result } = renderHook(() => useCreateScope('acme'), { wrapper });
  let missed: readonly string[] = ['unset'];
  await act(async () => {
    missed = await result.current.fill('s1', [], []);
  });
  expect(missed).toEqual([]);
  expect(sent).toEqual([]);
});

it('answers the parts that did not take, in the order they were made', async () => {
  const { wrapper } = hookHarness({
    ...READS,
    [`PUT ${S1}/roles`]: problem(412),
    [`PUT ${S1}/mappers`]: problem(500),
  });
  const { result } = renderHook(() => useCreateScope('acme'), { wrapper });
  let missed: readonly string[] = [];
  await act(async () => {
    missed = await result.current.fill('s1', ['r-aud'], ['email']);
  });
  expect(missed).toEqual(['roles', 'mappers']);
});

it('counts a part whose read failed as missed, without writing it', async () => {
  const { wrapper, sent } = hookHarness({ ...READS, [`GET ${S1}/roles`]: problem(500), ...PUTS });
  const { result } = renderHook(() => useCreateScope('acme'), { wrapper });
  let missed: readonly string[] = [];
  await act(async () => {
    missed = await result.current.fill('s1', ['r-aud'], ['email']);
  });
  expect(missed).toEqual(['roles']);
  expect(sent.filter((request) => request.path === `${S1}/roles`)).toHaveLength(1);
});

it('counts a part whose read gave no tag as missed, without writing it', async () => {
  const { wrapper, sent } = hookHarness({
    ...READS,
    [`GET ${S1}/roles`]: json({ items: [] }),
    ...PUTS,
  });
  const { result } = renderHook(() => useCreateScope('acme'), { wrapper });
  let missed: readonly string[] = [];
  await act(async () => {
    missed = await result.current.fill('s1', ['r-aud'], ['email']);
  });
  expect(missed).toEqual(['roles']);
  expect(sent.filter((request) => request.method === 'PUT').map((request) => request.path)).toEqual(
    [`${S1}/mappers`],
  );
});
