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
  kind: 'alternative' | 'single';
  members: Step[];
}

// A disabled step is treated as absent, not merely skipped: it is filtered
// out before grouping runs, so two alternative runs it separated become one
// run, exactly as they would if the disabled step had never been listed.
function groupSteps(steps: readonly Step[]): Group[] {
  const groups: Group[] = [];
  for (const s of steps) {
    if (s.requirement === 'disabled') continue;
    const last = groups.at(-1);
    if (s.requirement === 'alternative' && last?.kind === 'alternative') {
      last.members.push(s);
    } else {
      groups.push({
        kind: s.requirement === 'alternative' ? 'alternative' : 'single',
        members: [s],
      });
    }
  }
  return groups;
}

// An alternative run — one member or several — is satisfied only by an
// actual satisfied member; inapplicability never stands in for "someone
// else covered it". A non-alternative group of one is `conditional` or
// `required`, and only `conditional` treats inapplicability as satisfied:
// `required` must still be satisfied, so a subject it does not apply to
// falls through to the runnable search below and fails the flow.
function isGroupSatisfied(group: Group, state: FlowState): boolean {
  const anySatisfied = group.members.some((m) => state.satisfied.has(m.authenticator));
  if (anySatisfied) return true;
  if (group.kind === 'single') {
    const [only] = group.members;
    if (only === undefined || only.requirement === 'required') return false;
    return !only.applicable;
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
