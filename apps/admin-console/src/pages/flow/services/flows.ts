import { characterCount, FLOW_NAME_MAX } from '@odudu/contracts/admin';
import type { FlowWire, SaveFlowRequest } from '#/pages/flow/types/flows';
import type { Step } from '#/pages/flow/services/steps';
import { flowArea } from '#/pages/flow/services/flowWording';
import { areaHref } from '#/entities/area';
import type { Crumb } from '#/shared/lib/services/breadcrumb';
import { recordAddress } from '#/shared/lib/services/address';
import {
  namedCreation,
  removalOutcome,
  writeFailureText,
  type CreateSpec,
  type RemovalOutcome,
} from '#/shared/lib/services/failure';
import { counted } from '#/shared/lib/services/format';
import { problemAt, requiredProblem, type FieldProblem } from '#/shared/lib/services/fieldErrors';
import type { NamedDialog } from '#/shared/lib/services/dialog';
import type { GatewayResult, Problem } from '#/shared/lib/services/result';

export const FLOWS_RECORD = 'flows';

export function flowRecordName(id: string): string {
  return `${FLOWS_RECORD}/${id}`;
}

export function flowsHref(tenant: string): string {
  return areaHref(tenant, flowArea().area);
}

export function newFlowHref(tenant: string): string {
  return `${flowsHref(tenant)}/new`;
}

export function flowTrail(tenant: string, current: string): readonly Crumb[] {
  return [
    { label: 'Security' },
    { label: flowArea().title, href: flowsHref(tenant) },
    { label: current },
  ];
}

export interface FlowRow {
  flow: FlowWire;
  href: string;
  isDefault: boolean;
  summary: string;
  // The default flow is never deleted: a sign-in that names no flow runs it.
  deletable: boolean;
  // Any flow but the default may become it.
  promotable: boolean;
  promoteLabel: string;
  editLabel: string;
  deleteLabel: string;
}

export function stepSummary(steps: readonly Step[]): string {
  if (steps.length === 0) return 'No steps';
  const names = steps.map((step) => step.authenticator).join(', ');
  return `${counted(steps.length, 'step', 'steps')}: ${names}`;
}

export function flowHref(tenant: string, id: string): string {
  return recordAddress(flowsHref(tenant), id);
}

export function flowRows(tenant: string, flows: readonly FlowWire[] | undefined): FlowRow[] {
  return (flows ?? []).map((flow) => ({
    flow,
    href: flowHref(tenant, flow.id),
    isDefault: flow.is_default,
    summary: stepSummary(flow.steps),
    deletable: !flow.is_default,
    promotable: !flow.is_default,
    promoteLabel: `Make ${flow.name} the default`,
    editLabel: `Edit ${flow.name}`,
    deleteLabel: `Delete ${flow.name}`,
  }));
}

function nameProblem(name: string): string | null {
  return (
    requiredProblem(name, 'Enter a name.') ??
    (characterCount(name.trim()) > FLOW_NAME_MAX
      ? `Use at most ${String(FLOW_NAME_MAX)} characters.`
      : null)
  );
}

const NO_DEFAULT = 'This tenant has no default flow to copy the steps from.';

// A new flow starts as a copy of the default flow's steps, which already
// passed the server's checks; the steps are changed once the flow is made.
// While `problem` is set nothing is sent, and `send` is not used.
export function creationOf(
  name: string,
  flows: readonly FlowWire[] | undefined,
): { problem: FieldProblem<'name'> | null; send: SaveFlowRequest } {
  const start = flows?.find((flow) => flow.is_default);
  return {
    problem: problemAt('name', nameProblem(name) ?? (start === undefined ? NO_DEFAULT : null)),
    send: { name: name.trim(), steps: [...(start?.steps ?? [])] },
  };
}

const TAKEN = 'about:blank#flow-name-taken';
const DEFAULT_FLOW = 'about:blank#default-flow';

// A 409 of the create is a name another flow holds or the cap; either reads
// as the server's own sentence under the name.
export function createSpec(name: string): CreateSpec {
  return {
    ...namedCreation('flow', name),
    fields: ['name'],
    taken: { field: 'name', fallback: 'A flow with this name already exists.' },
  };
}

const STALE =
  'The flow changed since it was read, so nothing was changed. Its steps are shown again: confirm once more if it is still what you mean.';

// What the flow holds now, so the confirmation is of the version it names.
function holds(flow: FlowWire): string {
  return `It holds ${stepSummary(flow.steps)}.`;
}

export function deleteDialog(flow: FlowWire | null): NamedDialog | null {
  if (flow === null) return null;
  return {
    title: `Delete ${flow.name}?`,
    consequence: `The flow and its steps are removed for good. ${holds(flow)}`,
    confirmLabel: `Delete ${flow.name}`,
    tone: 'danger',
  };
}

function deleteRefusal(problem: Problem): string | null {
  return problem.type === DEFAULT_FLOW
    ? 'The default flow is not deleted: a sign-in that names no flow runs it. Replace its steps instead.'
    : null;
}

export function deleteOutcome(name: string, result: GatewayResult<unknown>): RemovalOutcome {
  if (!result.ok && result.kind === 'problem') {
    const refused = deleteRefusal(result.problem);
    if (refused !== null) return { done: false, text: refused };
  }
  return removalOutcome(
    result,
    { doneText: `${name} was deleted.`, alreadyGoneText: `${name} was already deleted.` },
    { name, verb: 'deleted', lookAt: 'the flows', stale: STALE },
  );
}

// What a save of a flow's name says when another flow already holds it.
export function nameTakenExplanation(problem: Problem): string | null {
  return problem.type === TAKEN
    ? 'That name belongs to another flow of this tenant. Choose another.'
    : null;
}

// What the registry offers a step, from the list read; none until it is read.
export function availableOf(list: { available: readonly string[] } | undefined): readonly string[] {
  return list?.available ?? [];
}

// A save of a flow says a name another flow holds in the console's words, and
// leaves the rest to the shared refusal wording.
export function explainFlowSave(
  problem: Problem,
  refusal: (problem: Problem) => string | null,
): string | null {
  return nameTakenExplanation(problem) ?? refusal(problem);
}

export function promoteDialog(flow: FlowWire): NamedDialog {
  return {
    title: `Make ${flow.name} the default?`,
    consequence: `Every sign-in that names no flow runs it from now on, and a sign-in already under way takes its next step from it. The current default stays as an ordinary flow, which can then be deleted. ${holds(flow)}`,
    confirmLabel: 'Make default',
    tone: 'primary',
  };
}

export function promoteOutcome(name: string, result: GatewayResult<unknown>): RemovalOutcome {
  if (result.ok) return { done: true, text: `${name} is now the default flow.` };
  return {
    done: false,
    text: writeFailureText(result, {
      name,
      verb: 'made the default',
      lookAt: 'the flows',
      stale: STALE,
      missing: `${name} is no longer a flow of this tenant.`,
    }),
  };
}

export interface AskedAction {
  action: 'delete' | 'default';
  flow: FlowWire;
}

// The confirmation an asked action needs, or none while nothing is asked.
export function askedDialog(
  asked: AskedAction | null,
  current: FlowWire | undefined,
): NamedDialog | null {
  if (asked === null) return null;
  const flow = current ?? asked.flow;
  return asked.action === 'delete' ? deleteDialog(flow) : promoteDialog(flow);
}

// What the confirmation says while the flow it binds to is not read.
export function askedReadProblem(status: string): string | null {
  switch (status) {
    case 'failed':
      return 'The flow could not be read, so it cannot be confirmed. Close this and try again.';
    case 'missing':
      return 'This flow no longer exists. Close this and read the list again.';
    default:
      return null;
  }
}

// The request a flow's name and steps make, as the server takes it.
export function flowSaveRequest(values: { name: string; steps: readonly Step[] }): SaveFlowRequest {
  return { name: values.name.trim(), steps: [...values.steps] };
}

export function askedOutcome(asked: AskedAction, result: GatewayResult<unknown>): RemovalOutcome {
  return asked.action === 'delete'
    ? deleteOutcome(asked.flow.name, result)
    : promoteOutcome(asked.flow.name, result);
}
