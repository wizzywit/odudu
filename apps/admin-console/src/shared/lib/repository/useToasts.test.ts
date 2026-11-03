import { renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useToast, useToasts } from '#/shared/lib/repository/useToasts';
import { resetConsole } from '#/testing/resetConsole';

afterEach(() => {
  resetConsole();
});

it('queues toasts in order, each with its own id', () => {
  const { push } = useToasts.getState();
  const saved = push({ tone: 'success', message: 'Client saved' });
  const failed = push({ tone: 'error', message: 'Could not reach the server' });
  expect(saved).not.toBe(failed);
  expect(useToasts.getState().toasts).toEqual([
    { id: saved, tone: 'success', message: 'Client saved' },
    { id: failed, tone: 'error', message: 'Could not reach the server' },
  ]);
});

it('dismisses one toast and leaves the others', () => {
  const { push, dismiss } = useToasts.getState();
  const first = push({ tone: 'success', message: 'One' });
  const second = push({ tone: 'success', message: 'Two' });
  dismiss(first);
  expect(useToasts.getState().toasts.map((t) => t.id)).toEqual([second]);
  dismiss('no-such-toast');
  expect(useToasts.getState().toasts.map((t) => t.id)).toEqual([second]);
});

it('says a success and a failure with their tones', () => {
  const { result } = renderHook(() => useToast());
  result.current.succeeded('Client saved');
  result.current.failed('Could not reach the server');
  expect(useToasts.getState().toasts.map(({ tone, message }) => ({ tone, message }))).toEqual([
    { tone: 'success', message: 'Client saved' },
    { tone: 'error', message: 'Could not reach the server' },
  ]);
});
