import { type KeyLane } from '#/features/overview/service/keys.ts';

export function laneText(lane: KeyLane): string {
  return lane === 'unlisted' ? 'not in the key list' : lane;
}

export function unreadableTitle(what: string): string {
  return `The ${what} could not be read`;
}

const NUMBER = new Intl.NumberFormat('en');

export function limitText(limit: number): string {
  return ` of ${NUMBER.format(limit)} allowed`;
}

export function countAgainLabel(noun: string): string {
  return `Count ${noun} again`;
}

export function openPlaceLabel(place: string): string {
  return `Open ${place}`;
}

export const UNCHECKED_LEAD = 'Some checks need a capability you do not hold: ';
