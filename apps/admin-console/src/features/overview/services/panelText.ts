import { type KeyLane } from '#/features/overview/services/keys';
import { groupedNumber } from '#/shared/services/format';

export function laneText(lane: KeyLane): string {
  return lane === 'unlisted' ? 'not in the key list' : lane;
}

export function unreadableTitle(what: string): string {
  return `The ${what} could not be read`;
}

export function limitText(limit: number): string {
  return ` of ${groupedNumber(limit)} allowed`;
}

export function countAgainLabel(noun: string): string {
  return `Count ${noun} again`;
}

export function openPlaceLabel(place: string): string {
  return `Open ${place}`;
}

export const UNCHECKED_LEAD = 'Some checks need a capability you do not hold: ';
