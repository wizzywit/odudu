import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useCreateGroup } from '#/pages/groups/repository/useCreateGroup';
import { json } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { group, record } from '#/testing/groupAnswers';
import { G } from '#/testing/groupsFixtures';

it('reads the lists and pickers that show it again once it is created, and not when it is refused', async () => {
  const { wrapper, invalidated } = hookHarness({
    [`POST ${G}`]: json(record(group('g-new', '/qa')), 201),
  });
  const { result } = renderHook(() => useCreateGroup('acme'), { wrapper });
  await act(async () => {
    await result.current.create({ name: 'qa', description: '', parentId: null });
  });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['list', 'acme', 'groups'] });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['picker', 'acme', 'groups'] });
});

it('reads nothing again when the creation was refused', async () => {
  const { wrapper, invalidated } = hookHarness({});
  const { result } = renderHook(() => useCreateGroup('acme'), { wrapper });
  await act(async () => {
    await result.current.create({ name: 'qa', description: '', parentId: null });
  });
  expect(invalidated).not.toHaveBeenCalled();
});
