import type {
  ExecutionRequirement,
  ExecutionStep,
  FlowStepSettings,
} from '#/pages/flow/types/executions';
import { settingsSummary } from '#/pages/flow/services/stepSettings';
import { listOrNone } from '#/shared/lib/services/format';
import { isRecord } from '#/shared/lib/services/json';

export interface Step {
  authenticator: string;
  requirement: ExecutionRequirement;
  // What the step overrides of the tenant's authenticator settings; absent
  // where it overrides none.
  settings?: FlowStepSettings | undefined;
}

export type Direction = 'up' | 'down';

function withoutIndex({ authenticator, requirement, settings }: Step): Step {
  return { authenticator, requirement, ...(settings === undefined ? {} : { settings }) };
}

export function stepsOf(items: readonly ExecutionStep[]): Step[] {
  return [...items].sort((a, b) => a.index - b.index).map(withoutIndex);
}

// A named flow's steps carry no index: their order is the array's.
export function flowStepsOf(steps: readonly Step[]): Step[] {
  return steps.map(withoutIndex);
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
    steps.map((step, at) => {
      const settings = settingsSummary(step.settings);
      const said = settings === '' ? step.requirement : `${step.requirement}; ${settings}`;
      return `${String(at + 1)} ${step.authenticator} (${said})`;
    }),
    { join: 'comma' },
  );
}

// What the picker shows chosen: the pick while it is still offered, else the first.
export function chosenAddition(names: readonly string[], picked: string): string {
  return names.includes(picked) ? picked : (names[0] ?? '');
}
