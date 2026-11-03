import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useCreateRole } from '#/pages/roles/repository/useCreateRole';
import { json } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { R } from '#/testing/rolesFixtures';
import { role } from '#/testing/roleAnswers';
it('reads the lists and pickers that show it again once it is created, and not when it is refused', async () => {
  const { wrapper, invalidated } = hookHarness({
    [`POST ${R}`]: json(role('r-new', 'billing'), 201),
  });
  const { result } = renderHook(() => useCreateRole('acme'), { wrapper });
  await act(async () => {
    await result.current.create({ name: 'billing', description: '' });
  });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['list', 'acme', 'roles'] });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['picker', 'acme', 'roles'] });
});

it('reads nothing again when the creation was refused', async () => {
  const { wrapper, invalidated } = hookHarness({});
  const { result } = renderHook(() => useCreateRole('acme'), { wrapper });
  await act(async () => {
    await result.current.create({ name: 'billing', description: '' });
  });
  expect(invalidated).not.toHaveBeenCalled();
});
