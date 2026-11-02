import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useEndOwnSession } from '#/entities/session/use-cases/useEndOwnSession';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';

const KEPT = 'odudu.console.drafts';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  resetConsole();
});

it('forgets this tab’s drafts and starts the console again signed out', async () => {
  sessionStorage.setItem(
    KEPT,
    JSON.stringify({
      owner: 'acme/s1',
      drafts: { 'acme/subjects/s1': { account: { etag: null, values: { username: 'grace' } } } },
    }),
  );
  const { wrapper, leavePage } = hookHarness({});
  const { result } = renderHook(() => useEndOwnSession(), { wrapper });
  await act(async () => {
    await result.current();
  });
  expect(sessionStorage.getItem(KEPT)).toBeNull();
  expect(leavePage).toHaveBeenCalledWith('/console/');
});
