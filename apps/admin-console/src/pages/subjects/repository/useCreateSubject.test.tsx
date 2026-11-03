import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useCreateSubject } from '#/pages/subjects/repository/useCreateSubject';
import { json } from '#/testing/fakeTransport';
import { hookHarness } from '#/testing/hookHarness';
import { ADA, S } from '#/testing/subjectsFixtures';

it('reads the lists and pickers that show it again once it is created, and not when it is refused', async () => {
  const { wrapper, invalidated } = hookHarness({ [`POST ${S}`]: json(ADA, 201) });
  const { result } = renderHook(() => useCreateSubject('acme'), { wrapper });
  await act(async () => {
    await result.current.create({ username: 'ada', email: '' });
  });
  expect(invalidated).toHaveBeenCalledWith({ queryKey: ['list', 'acme', 'subjects'] });
});

it('reads nothing again when the creation was refused', async () => {
  const { wrapper, invalidated } = hookHarness({});
  const { result } = renderHook(() => useCreateSubject('acme'), { wrapper });
  await act(async () => {
    await result.current.create({ username: 'ada', email: '' });
  });
  expect(invalidated).not.toHaveBeenCalled();
});
