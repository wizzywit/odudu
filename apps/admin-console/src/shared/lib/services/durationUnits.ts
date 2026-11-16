import { UNIT_SECONDS } from '#/shared/lib/services/format';

export interface DurationUnit {
  id: 's' | 'min' | 'h' | 'd';
  seconds: number;
}

export const DURATION_UNITS: readonly DurationUnit[] = [
  { id: 's', seconds: UNIT_SECONDS.second },
  { id: 'min', seconds: UNIT_SECONDS.minute },
  { id: 'h', seconds: UNIT_SECONDS.hour },
  { id: 'd', seconds: UNIT_SECONDS.day },
];

const SECONDS: DurationUnit = { id: 's', seconds: UNIT_SECONDS.second };

export function durationUnit(id: string): DurationUnit {
  return DURATION_UNITS.find((unit) => unit.id === id) ?? SECONDS;
}

// The largest unit a number of seconds is a whole count of, so what is typed
// reads back exactly.
export function fittingUnit(seconds: number): DurationUnit {
  if (!Number.isFinite(seconds) || seconds <= 0) return SECONDS;
  return [...DURATION_UNITS].reverse().find((unit) => seconds % unit.seconds === 0) ?? SECONDS;
}

// The unit a person picked, for as long as the value is a whole count of it.
export function unitShown(seconds: number, picked: DurationUnit | null): DurationUnit {
  if (picked === null) return fittingUnit(seconds);
  return Number.isNaN(seconds) || seconds % picked.seconds === 0 ? picked : fittingUnit(seconds);
}

// Whether the seconds are a whole count of the unit, so choosing it changes only how they read.
export function holds(seconds: number, unit: DurationUnit): boolean {
  return !Number.isFinite(seconds) || seconds % unit.seconds === 0;
}

export function unitLabel(label: string): string {
  return `${label}, unit`;
}

export function inUnit(seconds: number, unit: DurationUnit): number {
  return Number.isFinite(seconds) ? seconds / unit.seconds : Number.NaN;
}

export function secondsOf(entered: number, unit: DurationUnit): number {
  return Number.isNaN(entered) ? entered : Math.round(entered * unit.seconds);
}
