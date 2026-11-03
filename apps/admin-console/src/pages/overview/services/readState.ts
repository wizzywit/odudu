import type { GatewayResult } from '#/shared/services/result';
import { mapRead, readOutcome } from '#/shared/services/read';
import type { OverviewRead } from '#/pages/overview/types/overviewReads';

export function overviewOutcome<T>(
  asked: boolean,
  result: GatewayResult<T> | undefined,
  retry: () => void,
): OverviewRead<T> {
  return asked ? readOutcome(result, retry) : { status: 'off' };
}

export function mapOverviewRead<T, U>(read: OverviewRead<T>, map: (data: T) => U): OverviewRead<U> {
  return read.status === 'off' ? read : mapRead(read, map);
}

export function readyData<T>(read: OverviewRead<T>): T | undefined {
  return read.status === 'ready' ? read.data : undefined;
}
