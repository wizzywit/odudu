import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ownCreation } from '#/entities/creation-draft/repository/storedCreation';
import { useCreationProgress } from '#/entities/creation-draft/repository/useCreationProgress';
import { administratorOf, freshCreation } from '#/entities/creation-draft/services/creationDraft';

afterEach(() => {
  sessionStorage.clear();
});

it('starts a flow fresh and keeps every change, so a reload resumes the last', () => {
  const first = renderHook(() => useCreationProgress('system/s0', 'administrator/acme'));
  expect(first.result.current.creation).toEqual(freshCreation('administrator/acme'));
  const typed = { ...administratorOf('acme', 'existing'), username: 'ada' };
  act(() => {
    first.result.current.update(typed);
  });
  first.unmount();
  const reloaded = renderHook(() => useCreationProgress('system/s0', 'administrator/acme'));
  expect(reloaded.result.current.creation).toEqual(typed);
});

it('forgets a finished creation once the page is left, not before', () => {
  const done = { step: 'done', tenant: 'acme', username: 'ada' } as const;
  const page = renderHook(() => useCreationProgress('system/s0', 'tenant'));
  act(() => {
    page.result.current.update(done);
  });
  expect(page.result.current.creation).toEqual(done);
  page.unmount();
  expect(ownCreation('system/s0', 'tenant')).toBeNull();
  const next = renderHook(() => useCreationProgress('system/s0', 'tenant'));
  expect(next.result.current.creation).toEqual(freshCreation('tenant'));
});
