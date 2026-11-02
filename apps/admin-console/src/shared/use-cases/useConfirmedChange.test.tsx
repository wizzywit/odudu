import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Write } from '#/shared/repository/useWrite';
import { useConfirmedChange, useConfirmedRemoval } from '#/shared/use-cases/useConfirmedChange';
import type { GatewayFailure, GatewayResult } from '#/shared/transport/gateway';

const done: GatewayResult<string> = { ok: true, status: 200, data: 'ok', etag: null, next: null };
const refused: GatewayFailure = { ok: false, kind: 'defect' };

function setup(answer: () => Promise<GatewayResult<string>>, busy = false) {
  const run = vi.fn<(arg: number) => Promise<GatewayResult<string>>>(answer);
  const change: Write<number, GatewayResult<string>> = { busy, run };
  const report = vi.fn<(failure: GatewayFailure, needed: string) => boolean>(() => true);
  const onDone = vi.fn();
  const onRefused = vi.fn();
  const hook = renderHook(() =>
    useConfirmedChange({
      refusal: { report },
      capability: 'manage-users',
      change,
      failureText: (failure) => `said ${failure.kind}`,
      done: onDone,
      onRefused,
    }),
  );
  return { hook, run, report, onDone, onRefused };
}

it('asks, sends what was asked once, closes and says it is done', async () => {
  const { hook, run, onDone, report } = setup(() => Promise.resolve(done));
  act(() => {
    hook.result.current.ask(7);
  });
  expect(hook.result.current.asking).toBe(7);
  await act(async () => {
    hook.result.current.confirm();
    await Promise.resolve();
  });
  expect(run).toHaveBeenCalledExactlyOnceWith(7);
  expect(onDone).toHaveBeenCalledWith(7, 'ok');
  expect(hook.result.current.asking).toBeNull();
  expect(report).not.toHaveBeenCalled();
});

it('says a refusal in the dialog, tells the reporter what was needed and keeps asking', async () => {
  const { hook, report, onRefused, onDone } = setup(() => Promise.resolve(refused));
  act(() => {
    hook.result.current.ask(1);
  });
  await act(async () => {
    hook.result.current.confirm();
    await Promise.resolve();
  });
  expect(report).toHaveBeenCalledWith(refused, 'manage-users');
  expect(onRefused).toHaveBeenCalledWith(refused);
  expect(hook.result.current.problem).toBe('said defect');
  expect(hook.result.current.asking).toBe(1);
  expect(onDone).not.toHaveBeenCalled();
});

it('says a send that threw as a defect, and clears the problem on the next ask or cancel', async () => {
  const { hook } = setup(() => Promise.reject(new Error('down')));
  act(() => {
    hook.result.current.ask(1);
  });
  await act(async () => {
    hook.result.current.confirm();
    await Promise.resolve();
  });
  expect(hook.result.current.problem).toBe('said defect');
  act(() => {
    hook.result.current.cancel();
  });
  expect(hook.result.current.problem).toBeNull();
  expect(hook.result.current.asking).toBeNull();
});

it('sends nothing while it is busy or when nothing was asked', () => {
  const idle = setup(() => Promise.resolve(done));
  act(() => {
    idle.hook.result.current.confirm();
  });
  expect(idle.run).not.toHaveBeenCalled();
  const busy = setup(() => Promise.resolve(done), true);
  act(() => {
    busy.hook.result.current.ask(1);
  });
  act(() => {
    busy.hook.result.current.confirm();
  });
  expect(busy.run).not.toHaveBeenCalled();
});

it('asks a removal as a yes or a no and hands the answer on', async () => {
  const run = vi.fn(() => Promise.resolve(done));
  const finished = vi.fn();
  const { result } = renderHook(() =>
    useConfirmedRemoval({
      refusal: { report: () => true },
      capability: 'manage-tenant',
      change: { busy: false, run },
      failureText: (failure) => failure.kind,
      done: finished,
    }),
  );
  expect(result.current.confirming).toBe(false);
  act(() => {
    result.current.ask();
  });
  expect(result.current.confirming).toBe(true);
  await act(async () => {
    result.current.confirm();
    await Promise.resolve();
  });
  expect(run).toHaveBeenCalledOnce();
  expect(finished).toHaveBeenCalledWith('ok');
  expect(result.current.confirming).toBe(false);
});
