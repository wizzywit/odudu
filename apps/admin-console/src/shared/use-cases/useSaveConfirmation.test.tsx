import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useSaveConfirmation } from '#/shared/use-cases/useSaveConfirmation';

function setup() {
  const submit = vi.fn(() => true);
  const hook = renderHook(() => useSaveConfirmation<string>({ submit }));
  return { hook, submit };
}

it('keeps what was asked until it is confirmed or cancelled', () => {
  const { hook, submit } = setup();
  expect(hook.result.current.confirming).toBeNull();
  act(() => {
    hook.result.current.ask('leave a group');
  });
  expect(hook.result.current.confirming).toBe('leave a group');
  expect(submit).not.toHaveBeenCalled();
  act(() => {
    hook.result.current.cancel();
  });
  expect(hook.result.current.confirming).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

it('closes the question and sends the save once it is confirmed', () => {
  const { hook, submit } = setup();
  act(() => {
    hook.result.current.ask('leave a group');
  });
  act(() => {
    hook.result.current.confirm();
  });
  expect(hook.result.current.confirming).toBeNull();
  expect(submit).toHaveBeenCalledOnce();
});
