import { describe, expect, it } from 'vitest';
import type { GatewayResult } from '#/shared/services/result';
import { mapOverviewRead, overviewOutcome } from '#/features/overview/services/readState';
import type { OverviewRead } from '#/features/overview/types/overviewReads';
import { retry, FAILED, ready } from '#/testing/overviewFixtures';

describe('a read as a gateway answer reads, for the overview', () => {
  const answered = (data: number): GatewayResult<number> => ({
    ok: true,
    status: 200,
    data,
    etag: null,
    next: null,
  });

  it('is off when it was not asked, however it was answered', () => {
    expect(overviewOutcome(false, answered(1), retry)).toEqual({ status: 'off' });
  });

  it('is what the read says once it was asked', () => {
    expect(overviewOutcome(true, undefined, retry)).toEqual({ status: 'loading' });
    expect(overviewOutcome(true, answered(7), retry)).toEqual({ status: 'ready', data: 7 });
  });

  it('maps what is ready and passes every other state through', () => {
    expect(mapOverviewRead(ready(2), (n) => n * 2)).toEqual({ status: 'ready', data: 4 });
    const off: OverviewRead<number> = { status: 'off' };
    expect(mapOverviewRead<number, number>(off, (n) => n * 2)).toBe(off);
    expect(mapOverviewRead(FAILED, (n: number) => n * 2)).toBe(FAILED);
  });
});
