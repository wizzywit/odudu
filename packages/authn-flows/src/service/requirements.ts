import { type Requirement } from '#/schema/execution';

export interface Step {
  authenticator: string;
  requirement: Requirement;
  applicable: boolean;
}

export interface FlowState {
  satisfied: ReadonlySet<string>;
}

export type NextStep =
  { kind: 'run'; authenticator: string } | { kind: 'complete' } | { kind: 'fail' };

interface Group {
  members: Step[];
}

// A run of adjacent `alternative` steps forms one group; every other step is
// a group of its own. `disabled` steps are dropped before grouping, so
// removing one never merges the alternatives that sat on either side of it.
function groupSteps(steps: readonly Step[]): Group[] {
  const groups: Group[] = [];
  for (const s of steps) {
    if (s.requirement === 'disabled') continue;
    const last = groups.at(-1);
    const lastIsAlternative =
      last !== undefined && last.members.at(-1)?.requirement === 'alternative';
    if (s.requirement === 'alternative' && last !== undefined && lastIsAlternative) {
      last.members.push(s);
    } else {
      groups.push({ members: [s] });
    }
  }
  return groups;
}

// An alternative run of more than one member needs an actual satisfied
// member — being merely inapplicable does not stand in for "someone else
// covered it". A group of one is satisfied by its member's success or by
// that member simply not applying to this subject.
function isGroupSatisfied(group: Group, state: FlowState): boolean {
  const anySatisfied = group.members.some((m) => state.satisfied.has(m.authenticator));
  if (anySatisfied) return true;
  if (group.members.length === 1) {
    const [only] = group.members;
    return only !== undefined && !only.applicable;
  }
  return false;
}

export function nextStep(executions: readonly Step[], state: FlowState): NextStep {
  const groups = groupSteps(executions);
  if (groups.length === 0) return { kind: 'fail' };

  for (const group of groups) {
    if (isGroupSatisfied(group, state)) continue;

    const runnable = group.members.find((m) => m.applicable);
    if (runnable === undefined) return { kind: 'fail' };
    return { kind: 'run', authenticator: runnable.authenticator };
  }

  return { kind: 'complete' };
}
