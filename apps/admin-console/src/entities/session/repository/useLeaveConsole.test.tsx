import { renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useLeaveConsole } from '#/entities/session/repository/useLeaveConsole';
import { useUnsavedGuard } from '#/shared/lib/repository/useUnsavedGuard';
import { hookHarness } from '#/testing/hookHarness';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
});

it('sends the window away and tells the guard first, so the unload prompt stays quiet', () => {
  const { wrapper, leavePage } = hookHarness({});
  const { result } = renderHook(() => useLeaveConsole(), { wrapper });
  useUnsavedGuard.getState().setDirty('client/general', 'General');
  leavePage.mockImplementation(() => {
    expect(useUnsavedGuard.getState().released).toBe(true);
  });
  result.current('/console/auth/login');
  expect(leavePage).toHaveBeenCalledWith('/console/auth/login');
  expect(useUnsavedGuard.getState().released).toBe(true);
});
