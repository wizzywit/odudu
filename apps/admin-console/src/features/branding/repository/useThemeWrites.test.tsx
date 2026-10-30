import type { ThemeView } from '@odudu/contracts/admin';
import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useThemeWrites } from '#/features/branding/repository/useThemeWrites';
import { draftedView, TH, themeView } from '#/testing/brandingFixtures';
import { json, problem } from '#/testing/fakeTransport';
import { hookHarness as harness } from '#/testing/hookHarness';

const TENANT = { kind: 'tenant' } as const;

it('writes what a publish answers over the theme record, and asks for the versions again', async () => {
  const published = { ...draftedView(), draft: null, warnings: [] };
  const { wrapper, queryClient, invalidated } = harness({
    [`POST ${TH}/publish`]: json(published),
  });
  const { result } = renderHook(() => useThemeWrites('acme', TENANT), { wrapper });
  await act(async () => {
    await result.current.publish.run('"d1"');
  });
  const entry = queryClient.getQueryData<{ result: { data: ThemeView; etag: string }; by: string }>(
    ['record', 'acme', 'theme'],
  );
  expect(entry?.by).toBe('save');
  expect(entry?.result.data.draft).toBeNull();
  expect(entry?.result.etag).toBe('"no-draft"');
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['theme-versions', 'acme', 'tenant'] });
});

it('reads the theme again when a publish finds the draft has moved on', async () => {
  const { wrapper, invalidated } = harness({
    [`POST ${TH}/publish`]: problem(412, 'about:blank', 'Precondition Failed'),
  });
  const { result } = renderHook(() => useThemeWrites('acme', TENANT), { wrapper });
  await act(async () => {
    await result.current.publish.run('"old"');
  });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['record', 'acme', 'theme'], exact: true });
});

it('changes nothing when a restore or a reset is refused', async () => {
  const { wrapper, queryClient } = harness({
    [`POST ${TH}/versions/v1/restore`]: problem(
      409,
      'about:blank#theme-assets-missing',
      'Conflict',
    ),
    [`DELETE ${TH}`]: problem(403, 'about:blank', 'Forbidden'),
  });
  const { result } = renderHook(() => useThemeWrites('acme', TENANT), { wrapper });
  await act(async () => {
    await result.current.restore.run('v1');
    await result.current.reset.run();
  });
  expect(queryClient.getQueryData(['record', 'acme', 'theme'])).toBeUndefined();
});

it('writes a reset’s answer over the record', async () => {
  const { wrapper, queryClient } = harness({ [`DELETE ${TH}`]: json(themeView()) });
  const { result } = renderHook(() => useThemeWrites('acme', TENANT), { wrapper });
  await act(async () => {
    await result.current.reset.run();
  });
  expect(queryClient.getQueryData(['record', 'acme', 'theme'])).toBeDefined();
});

it('writes a discard’s answer over the record and leaves the versions alone', async () => {
  const { wrapper, queryClient, invalidated } = harness({
    [`DELETE ${TH}/draft`]: json({ ...draftedView(), draft: null, changed: [] }),
  });
  const { result } = renderHook(() => useThemeWrites('acme', TENANT), { wrapper });
  await act(async () => {
    await result.current.discard.run('"d1"');
  });
  const entry = queryClient.getQueryData<{ result: { data: ThemeView; etag: string }; by: string }>(
    ['record', 'acme', 'theme'],
  );
  expect(entry?.by).toBe('save');
  expect(entry?.result.data.draft).toBeNull();
  expect(entry?.result.data.published).not.toBeNull();
  expect(invalidated).not.toHaveBeenCalled();
});

it('writes a revert’s answer over the record, and reads again when the draft has moved on', async () => {
  const { wrapper, queryClient, invalidated } = harness({
    [`PUT ${TH}`]: json(draftedView(), 200, { etag: '"d2"' }),
  });
  const { result } = renderHook(() => useThemeWrites('acme', TENANT), { wrapper });
  await act(async () => {
    await result.current.revert.run({ body: { stylesheet: null }, tag: '"d1"' });
  });
  expect(queryClient.getQueryData(['record', 'acme', 'theme'])).toBeDefined();
  expect(invalidated).not.toHaveBeenCalled();

  const stale = harness({ [`PUT ${TH}`]: problem(412, 'about:blank', 'Precondition Failed') });
  const again = renderHook(() => useThemeWrites('acme', TENANT), { wrapper: stale.wrapper });
  await act(async () => {
    await again.result.current.revert.run({ body: { stylesheet: null }, tag: '"old"' });
  });
  expect(stale.invalidated).toHaveBeenCalledWith({
    queryKey: ['record', 'acme', 'theme'],
    exact: true,
  });
});

it('reads the theme again when a discard finds the draft gone, or a publish finds none', async () => {
  const gone = harness({
    [`DELETE ${TH}/draft`]: problem(404, 'about:blank', 'Not Found'),
    [`POST ${TH}/publish`]: problem(409, 'about:blank#theme-no-draft', 'Conflict'),
  });
  const { result } = renderHook(() => useThemeWrites('acme', TENANT), { wrapper: gone.wrapper });
  await act(async () => {
    await result.current.discard.run('"d1"');
  });
  expect(gone.invalidated).toHaveBeenCalledTimes(1);
  await act(async () => {
    await result.current.publish.run('"d1"');
  });
  expect(gone.invalidated).toHaveBeenCalledTimes(2);
  expect(gone.invalidated).toHaveBeenCalledWith({
    queryKey: ['record', 'acme', 'theme'],
    exact: true,
  });
});

it('does not read the theme again for a publish refused over its content', async () => {
  const refused = harness({
    [`POST ${TH}/publish`]: problem(409, 'about:blank#theme-nothing-to-publish', 'Conflict'),
  });
  const { result } = renderHook(() => useThemeWrites('acme', TENANT), { wrapper: refused.wrapper });
  await act(async () => {
    await result.current.publish.run('"d1"');
  });
  expect(refused.invalidated).not.toHaveBeenCalled();
});
