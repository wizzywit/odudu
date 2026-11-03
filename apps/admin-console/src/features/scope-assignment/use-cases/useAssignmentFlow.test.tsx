import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useToasts } from '#/shared/lib/repository/useToasts';
import type { GatewayFailure, GatewayResult } from '#/shared/api/transport/gateway';
import { useAssignmentFlow } from '#/features/scope-assignment/use-cases/useAssignmentFlow';
import { resetConsole } from '#/testing/resetConsole';

const done: GatewayResult<string> = { ok: true, status: 200, data: 'ok', etag: null, next: null };
const refused: GatewayFailure = { ok: false, kind: 'defect' };
const BILLING = { id: 'c1', name: 'billing' };

afterEach(() => {
  resetConsole();
});

function setup() {
  const report = vi.fn<(failure: GatewayFailure, needed: string) => boolean>(() => true);
  const onRefused = vi.fn();
  const hook = renderHook(() =>
    useAssignmentFlow({
      refusal: { report },
      capability: 'manage-clients',
      failureText: (failure, counterpart, verb) => `${counterpart} not ${verb}: ${failure.kind}`,
      onRefused,
    }),
  );
  return { hook, report, onRefused };
}

it('answers true and toasts what was done when the change went through', async () => {
  const { hook } = setup();
  let went = false;
  await act(async () => {
    went = await hook.result.current.perform(
      BILLING,
      'assigned',
      () => Promise.resolve(done),
      'Assigned.',
    );
  });
  expect(went).toBe(true);
  expect(useToasts.getState().toasts).toEqual([
    expect.objectContaining({ tone: 'success', message: 'Assigned.' }),
  ]);
  expect(hook.result.current.working).toBeNull();
  expect(hook.result.current.message).toBeNull();
});

it('says a refusal where the change was made and tells the reporter what it needed', async () => {
  const { hook, report, onRefused } = setup();
  let went = true;
  await act(async () => {
    went = await hook.result.current.perform(
      BILLING,
      'unassigned',
      () => Promise.resolve(refused),
      'Removed.',
    );
  });
  expect(went).toBe(false);
  expect(report).toHaveBeenCalledWith(refused, 'manage-clients');
  expect(onRefused).toHaveBeenCalledWith(refused);
  expect(hook.result.current.message).toBe('billing not unassigned: defect');
  expect(useToasts.getState().toasts).toEqual([]);
});

it('says a change that threw as a defect, and a new change clears what was said', async () => {
  const { hook } = setup();
  await act(async () => {
    await hook.result.current.perform(
      BILLING,
      'assigned',
      () => Promise.reject(new Error('down')),
      'Assigned.',
    );
  });
  expect(hook.result.current.message).toBe('billing not assigned: defect');
  await act(async () => {
    await hook.result.current.perform(
      BILLING,
      'assigned',
      () => Promise.resolve(done),
      'Assigned.',
    );
  });
  expect(hook.result.current.message).toBeNull();
});

it('lets one change run at a time, naming the one in flight', async () => {
  const { hook } = setup();
  let finish: (result: GatewayResult<string>) => void = () => undefined;
  let first: Promise<boolean> = Promise.resolve(false);
  act(() => {
    first = hook.result.current.perform(
      BILLING,
      'assigned',
      () =>
        new Promise<GatewayResult<string>>((resolve) => {
          finish = resolve;
        }),
      'Assigned.',
    );
  });
  expect(hook.result.current.working).toBe('c1');
  const second = vi.fn(() => Promise.resolve(done));
  let went = true;
  await act(async () => {
    went = await hook.result.current.perform(
      { id: 'c2', name: 'portal' },
      'assigned',
      second,
      'Assigned.',
    );
  });
  expect(went).toBe(false);
  expect(second).not.toHaveBeenCalled();
  await act(async () => {
    finish(done);
    await first;
  });
  expect(hook.result.current.working).toBeNull();
});

it('chooses the last id, and lets the choice go only once the assignment went', async () => {
  const { hook } = setup();
  act(() => {
    hook.result.current.choose(['a', 'b']);
  });
  expect(hook.result.current.chosenId).toBe('b');
  await act(async () => {
    await hook.result.current.assignChosen('b', () => Promise.resolve(false));
  });
  expect(hook.result.current.chosenId).toBe('b');
  await act(async () => {
    expect(await hook.result.current.assignChosen('b', () => Promise.resolve(true))).toBe(true);
  });
  expect(hook.result.current.chosenId).toBeNull();
  await act(async () => {
    expect(await hook.result.current.assignChosen(null, () => Promise.resolve(true))).toBe(false);
  });
});
