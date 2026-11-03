import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useSaveConfirmation } from '#/shared/lib/use-cases/useSaveConfirmation';

function setup() {
  const submit = vi.fn(() => true);
  const hook = renderHook(() => useSaveConfirmation<string>({ submit }));
  return { hook, submit };
}

it('keeps what was asked until it is confirmed or cancelled', () => {
  const { hook, submit } = setup();
  expect(hook.result.current.confirming).toBeNull();
  act(() => {
    hook.result.current.submitOrAsk('leave a group', { whenAsked: true });
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
    hook.result.current.submitOrAsk('leave a group', { whenAsked: true });
  });
  act(() => {
    hook.result.current.confirm();
  });
  expect(hook.result.current.confirming).toBeNull();
  expect(submit).toHaveBeenCalledOnce();
});

it('sends the save at once, and asks nothing, when there is nothing to ask', () => {
  const { hook, submit } = setup();
  let sent = false;
  act(() => {
    sent = hook.result.current.submitOrAsk(null, { whenAsked: false });
  });
  expect(sent).toBe(true);
  expect(submit).toHaveBeenCalledOnce();
  expect(hook.result.current.confirming).toBeNull();
});

it('tells the section what it is told when a question was asked, as each caller chose', () => {
  const { hook, submit } = setup();
  let letPressAgain = true;
  let keepGuard = false;
  act(() => {
    letPressAgain = hook.result.current.submitOrAsk('a', { whenAsked: false });
  });
  act(() => {
    keepGuard = hook.result.current.submitOrAsk('b', { whenAsked: true });
  });
  expect(letPressAgain).toBe(false);
  expect(keepGuard).toBe(true);
  expect(submit).not.toHaveBeenCalled();
});
