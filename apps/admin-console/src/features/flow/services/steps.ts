import type { ExecutionRequirement, ExecutionStep } from '@odudu/contracts/admin';
import { listOrNone } from '#/shared/services/format';
import { isRecord } from '#/shared/services/json';

export interface Step {
  authenticator: string;
  requirement: ExecutionRequirement;
}

export type Direction = 'up' | 'down';

export function stepsOf(items: readonly ExecutionStep[]): Step[] {
  return [...items]
    .sort((a, b) => a.index - b.index)
    .map(({ authenticator, requirement }) => ({ authenticator, requirement }));
}

function indexOf(steps: readonly Step[], authenticator: string): number {
  return steps.findIndex((step) => step.authenticator === authenticator);
}

export function canMove(
  steps: readonly Step[],
  authenticator: string,
  direction: Direction,
): boolean {
  const at = indexOf(steps, authenticator);
  if (at < 0) return false;
  return direction === 'up' ? at > 0 : at < steps.length - 1;
}

export function moved(steps: readonly Step[], authenticator: string, direction: Direction): Step[] {
  const at = indexOf(steps, authenticator);
  if (!canMove(steps, authenticator, direction)) return [...steps];
  const to = direction === 'up' ? at - 1 : at + 1;
  const next = [...steps];
  const [mine, theirs] = [next[at], next[to]];
  if (mine === undefined || theirs === undefined) return next;
  next[at] = theirs;
  next[to] = mine;
  return next;
}

export function withRequirement(
  steps: readonly Step[],
  authenticator: string,
  requirement: ExecutionRequirement,
): Step[] {
  return steps.map((step) =>
    step.authenticator === authenticator ? { ...step, requirement } : step,
  );
}

export function addable(available: readonly string[], steps: readonly Step[]): string[] {
  return available.filter((name) => indexOf(steps, name) < 0);
}

export function added(
  steps: readonly Step[],
  authenticator: string,
  requirement: ExecutionRequirement,
): Step[] {
  if (indexOf(steps, authenticator) >= 0) return [...steps];
  return [...steps, { authenticator, requirement }];
}

function isStep(value: unknown): value is Step {
  return isRecord(value) && 'authenticator' in value;
}

// A conflict's way of showing the order, one step after another.
export function describeSteps(value: unknown): string {
  const steps = Array.isArray(value) ? value.filter(isStep) : [];
  return listOrNone(
    steps.map((step, at) => `${String(at + 1)} ${step.authenticator} (${step.requirement})`),
    { join: 'comma' },
  );
}

// What the picker shows chosen: the pick while it is still offered, else the first.
export function chosenAddition(names: readonly string[], picked: string): string {
  return names.includes(picked) ? picked : (names[0] ?? '');
}
