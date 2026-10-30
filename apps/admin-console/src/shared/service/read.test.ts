import { describe, expect, it } from 'vitest';
import {
  freshness,
  RECENT_READ_MS,
  loadedData,
  mapRead,
  readOutcome,
  recordRead,
} from '#/shared/service/read';
import type { GatewayResult } from '#/shared/service/result';

const retry = (): void => undefined;

const answered = (data: number): GatewayResult<number> => ({
  ok: true,
  status: 200,
  data,
  etag: null,
  next: null,
});

const problem = (status: number): GatewayResult<number> => ({
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank', title: 'Problem', status },
});

describe('readOutcome', () => {
  it('is loading until it answers', () => {
    expect(readOutcome(undefined, retry)).toEqual({ status: 'loading' });
  });

  it('is ready with the data', () => {
    expect(readOutcome(answered(7), retry)).toEqual({ status: 'ready', data: 7 });
  });

  it('is failed, refused only for a 403, with the way to ask again', () => {
    expect(readOutcome(problem(403), retry)).toEqual({ status: 'failed', refused: true, retry });
    expect(readOutcome(problem(500), retry)).toMatchObject({ refused: false });
    expect(readOutcome({ ok: false, kind: 'network' }, retry)).toMatchObject({
      status: 'failed',
      refused: false,
    });
  });
});

describe('mapRead', () => {
  it('maps what is ready and passes loading and failure through', () => {
    expect(mapRead(readOutcome(answered(2), retry), (n) => n * 2)).toEqual({
      status: 'ready',
      data: 4,
    });
    const failed = readOutcome<number>(problem(500), retry);
    expect(mapRead(failed, (n) => n * 2)).toBe(failed);
    const loading = readOutcome<number>(undefined, retry);
    expect(mapRead(loading, (n) => n * 2)).toBe(loading);
  });
});

describe('loadedData', () => {
  it('is the data of a read that came, and nothing of one that did not', () => {
    expect(loadedData({ status: 'ready', data: 3 })).toBe(3);
    expect(loadedData({ status: 'loading' })).toBeUndefined();
    const failed = { status: 'failed' as const, retry };
    expect(loadedData(failed)).toBeUndefined();
  });
});

describe('recordRead', () => {
  const failure = problem(403) as Extract<GatewayResult<number>, { ok: false }>;

  it('is ready once there is data, and loading until a read answers', () => {
    expect(recordRead({ status: 'ready', data: 3, failure: null, retry })).toEqual({
      status: 'ready',
      data: 3,
    });
    expect(recordRead({ status: 'loading', data: undefined, failure: null, retry })).toEqual({
      status: 'loading',
    });
  });

  it('keeps data it already has when a later read fails', () => {
    expect(recordRead({ status: 'failed', data: 3, failure, retry })).toEqual({
      status: 'ready',
      data: 3,
    });
  });

  it('says a refusal was one, and any other failure was not', () => {
    expect(recordRead({ status: 'failed', data: undefined, failure, retry })).toMatchObject({
      status: 'failed',
      refused: true,
    });
    expect(
      recordRead({
        status: 'failed',
        data: undefined,
        failure: problem(500) as typeof failure,
        retry,
      }),
    ).toMatchObject({ refused: false });
    expect(recordRead({ status: 'missing', data: undefined, failure: null, retry })).toMatchObject({
      status: 'failed',
      refused: false,
    });
  });
});

describe('freshness', () => {
  it('keeps an immutable read and leaves any other to the client’s defaults', () => {
    expect(freshness(true)).toEqual({ staleTime: Infinity, refetchOnWindowFocus: false });
    expect(freshness(false)).toEqual({});
  });

  it('keeps a read just made for the moment a second observer of its key mounts', () => {
    expect(freshness(false, true)).toEqual({ staleTime: RECENT_READ_MS });
    expect(RECENT_READ_MS).toBeGreaterThan(0);
    expect(RECENT_READ_MS).toBeLessThanOrEqual(30_000);
    expect(freshness(true, true)).toEqual(freshness(true));
  });
});
