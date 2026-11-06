import type { PublishedLane } from '#/entities/signing-key';
import type { CountResponse } from '#/shared/lib/types/count';
import { groupedNumber } from '#/shared/lib/services/format';

export function laneText(lane: PublishedLane): string {
  return lane === 'unlisted' ? 'not in the key list' : lane;
}

export function unreadableTitle(what: string): string {
  return `The ${what} could not be read`;
}

export function limitText(limit: number, made: CountResponse): string {
  const shown = `${groupedNumber(made.count)}${made.capped ? '+' : ''}`;
  return ` (${shown} of ${groupedNumber(limit)} made by administrators or tokens)`;
}

export function countAgainLabel(noun: string): string {
  return `Count ${noun} again`;
}

export function openPlaceLabel(place: string): string {
  return `Open ${place}`;
}

export const UNCHECKED_LEAD = 'Some checks need a capability you do not hold: ';
