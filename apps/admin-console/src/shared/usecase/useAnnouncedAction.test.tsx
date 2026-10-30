import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useAnnouncedAction } from '#/shared/usecase/useAnnouncedAction';
import type { GatewayFailure, GatewayResult } from '#/shared/transport/gateway';

const done: GatewayResult<string> = { ok: true, status: 200, data: 'ok', etag: null, next: null };
const refused: GatewayFailure = { ok: false, kind: 'defect' };

function setup(
  answer: () => Promise<GatewayResult<string>>,
  outcome: (result: GatewayResult<unknown>) => { done: boolean; text: string; closes?: boolean },
  blocked = false,
) {
  const send = vi.fn<(what: number) => Promise<GatewayResult<unknown>>>(answer);
  const report = vi.fn<(result: GatewayResult<unknown>, needed: string) => boolean>(() => true);
  const hook = renderHook(() =>
    useAnnouncedAction<number>({
      refusal: { report },
      capability: 'manage-keys',
      blocked,
      send,
      outcomeOf: (_what, result) => outcome(result),
    }),
  );
  return { hook, send, report };
}

const said = (result: GatewayResult<unknown>) => ({
  done: result.ok,
  text: `said ${String(result.ok)}`,
});

it('sends what was asked once and, when it ended where meant, closes, tells and counts', async () => {
  const { hook, send, report } = setup(() => Promise.resolve(done), said);
  act(() => {
    hook.result.current.ask(7);
  });
  expect(hook.result.current.asked).toBe(7);
  let ended: boolean | undefined;
  await act(async () => {
    ended = await hook.result.current.confirm();
  });
  expect(ended).toBe(true);
  expect(send).toHaveBeenCalledExactlyOnceWith(7);
  expect(hook.result.current).toMatchObject({ asked: null, notice: 'said true', done: 1 });
  expect(report).not.toHaveBeenCalled();
});

it('says a refusal in the dialog, reports what was needed and keeps asking', async () => {
  const { hook, report } = setup(() => Promise.resolve(refused), said);
  act(() => {
    hook.result.current.ask(1);
  });
  let ended: boolean | undefined;
  await act(async () => {
    ended = await hook.result.current.confirm();
  });
  expect(ended).toBe(false);
  expect(report).toHaveBeenCalledWith(refused, 'manage-keys');
  expect(hook.result.current).toMatchObject({ asked: 1, problem: 'said false', done: 0 });
  expect(hook.result.current.notice).toBeNull();
});

it('clears a refusal on the next ask', async () => {
  const { hook } = setup(() => Promise.resolve(refused), said);
  act(() => {
    hook.result.current.ask(1);
  });
  await act(async () => {
    await hook.result.current.confirm();
  });
  expect(hook.result.current.problem).toBe('said false');
  act(() => {
    hook.result.current.ask(2);
  });
  expect(hook.result.current).toMatchObject({ asked: 2, problem: null });
});

it('leaves the notice of the last action when the next question is cancelled', async () => {
  const { hook } = setup(() => Promise.resolve(done), said);
  act(() => {
    hook.result.current.ask(1);
  });
  await act(async () => {
    await hook.result.current.confirm();
  });
  act(() => {
    hook.result.current.ask(2);
  });
  act(() => {
    hook.result.current.cancel();
  });
  expect(hook.result.current).toMatchObject({ asked: null, notice: 'said true' });
});

it('does nothing when nothing is asked, or while another write is under way', async () => {
  const unasked = setup(() => Promise.resolve(done), said);
  await act(async () => {
    expect(await unasked.hook.result.current.confirm()).toBe(false);
  });
  expect(unasked.send).not.toHaveBeenCalled();
  const held = setup(() => Promise.resolve(done), said, true);
  act(() => {
    held.hook.result.current.ask(1);
  });
  await act(async () => {
    expect(await held.hook.result.current.confirm()).toBe(false);
  });
  expect(held.send).not.toHaveBeenCalled();
});

it('closes the dialog and tells over the page when the outcome says the page must be looked at again', async () => {
  const { hook, send, report } = setup(
    () => Promise.resolve(refused),
    () => ({ done: false, closes: true, text: 'look again' }),
  );
  act(() => {
    hook.result.current.ask(3);
  });
  let ended: boolean | undefined;
  await act(async () => {
    ended = await hook.result.current.confirm();
  });
  expect(ended).toBe(false);
  expect(send).toHaveBeenCalledOnce();
  expect(report).toHaveBeenCalledWith(refused, 'manage-keys');
  expect(hook.result.current).toMatchObject({
    asked: null,
    problem: null,
    notice: 'look again',
    done: 1,
  });
});
