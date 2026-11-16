export interface DurationUnit {
  id: 's' | 'min' | 'h' | 'd';
  seconds: number;
}

export const DURATION_UNITS: readonly DurationUnit[] = [
  { id: 's', seconds: 1 },
  { id: 'min', seconds: 60 },
  { id: 'h', seconds: 3_600 },
  { id: 'd', seconds: 86_400 },
];

const SECONDS: DurationUnit = { id: 's', seconds: 1 };

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

// Another unit keeps the seconds where it divides them, and otherwise the
// nearest whole count of itself.
export function secondsAfterSwitch(seconds: number, to: DurationUnit): number {
  if (!Number.isFinite(seconds) || seconds % to.seconds === 0) return seconds;
  return Math.max(1, Math.round(seconds / to.seconds)) * to.seconds;
}

export function inUnit(seconds: number, unit: DurationUnit): number {
  return Number.isFinite(seconds) ? seconds / unit.seconds : Number.NaN;
}

export function secondsOf(entered: number, unit: DurationUnit): number {
  return Number.isNaN(entered) ? entered : Math.round(entered * unit.seconds);
}
