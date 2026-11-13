import {
  flowRepository,
  registeredAuthenticatorNames,
  startsALogin,
  type FlowStep,
} from '@odudu/authn-flows';
import {
  FLOW_LIMIT,
  type ExecutionStep,
  type FlowListItemWire,
  type FlowWire,
} from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { clientOidcConfigRepository } from '@odudu/protocol-oidc';
import { createdDetail, redactedDiff } from '#/service/audit-detail';
import { etagOf, requiredPrecondition } from '#/service/etag';
import { flowWireShape, stepWireShape } from '#/service/flow-wire';
import { validateFlowSteps } from '#/service/flow-validation';

export interface FlowAuditEvent {
  readonly action:
    'flow.replace' | 'flow.create' | 'flow.amend' | 'flow.delete' | 'flow.default_set';
  readonly resourceType: 'flow';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: FlowAuditEvent) => Promise<void>;

function toWireShape(step: FlowStep, index: number): ExecutionStep {
  return {
    index,
    authenticator: step.authenticator,
    requirement: step.requirement,
    ...(step.settings === undefined ? {} : { settings: step.settings }),
  };
}

export interface FlowView {
  readonly items: readonly ExecutionStep[];
  readonly available: readonly string[];
  readonly etag: string;
}

/**
 * The default flow's steps are already in order, which is the flow's
 * meaning, so the `ETag` needs no sort. It covers `items` alone: `available`
 * is the registry's, and no write here changes it.
 */
export async function listFlow(tx: TenantScopedDatabase, tenantId: string): Promise<FlowView> {
  const fallback = await flowRepository(tx).defaultForTenant(tenantId);
  const items = (fallback?.steps ?? []).map(toWireShape);
  return { items, available: registeredAuthenticatorNames(), etag: etagOf({ items }) };
}

export interface ReplaceFlowInput {
  readonly tenantId: string;
  readonly steps: FlowStep[];
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface ReplaceFlowDeps {
  readonly audit: Audit;
}

/** A step list refused at save time, before anything is read or written. */
export type StepsRefusal =
  | { kind: 'empty' }
  | { kind: 'unresolvable_authenticator'; name: string; known: readonly string[] }
  | { kind: 'duplicate_authenticator'; name: string }
  | { kind: 'unread_settings'; name: string; keys: string[]; read: readonly string[] }
  | { kind: 'no_enabled_step' }
  | { kind: 'no_step_runnable_at_start' };

/**
 * Shape is not enough: a flow every step of which stands down before any
 * subject is bound passes every check of `validateFlowSteps` and still
 * cannot render a first challenge.
 */
export function refuseSteps(steps: readonly FlowStep[]): StepsRefusal | null {
  const validated = validateFlowSteps(steps, registeredAuthenticatorNames());
  if (validated.kind !== 'ok') return validated;
  return startsALogin(steps) ? null : { kind: 'no_step_runnable_at_start' };
}

export type ReplaceFlowOutcome =
  | StepsRefusal
  | { kind: 'precondition_required' }
  | { kind: 'precondition_failed' }
  | {
      kind: 'ok';
      items: readonly ExecutionStep[];
      available: readonly string[];
      etag: string;
    };

/** Replaces a tenant's whole flow — no partial edit is offered, since a flow's meaning is in its order. */
export async function replaceFlow(
  tx: TenantScopedDatabase,
  deps: ReplaceFlowDeps,
  input: ReplaceFlowInput,
): Promise<ReplaceFlowOutcome> {
  const refusal = refuseSteps(input.steps);
  if (refusal !== null) return refusal;

  // Before the read, never after: the lock is what makes the comparison
  // below describe the flow this write overwrites, the same order
  // `amendSettings` and `amendClient` take theirs in.
  await flowRepository(tx).lockForTenant(input.tenantId);
  const before = await listFlow(tx, input.tenantId);
  const precondition = requiredPrecondition(input.ifMatch, before.etag);
  if (precondition !== 'ok') {
    return precondition === 'required'
      ? { kind: 'precondition_required' }
      : { kind: 'precondition_failed' };
  }

  const written = await flowRepository(tx).replaceDefaultSteps(input.tenantId, input.steps);

  await deps.audit(tx, {
    action: 'flow.replace',
    resourceType: 'flow',
    resourceId: input.tenantId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: redactedDiff(
      'flow',
      { steps: before.items.map(stepWireShape) },
      { steps: written.steps.map(stepWireShape) },
    ),
  });

  const items = written.steps.map(toWireShape);
  return {
    kind: 'ok',
    items,
    available: registeredAuthenticatorNames(),
    etag: etagOf({ items }),
  };
}

export interface FlowListView {
  readonly items: readonly FlowListItemWire[];
  readonly total: number;
  readonly available: readonly string[];
}

/**
 * Bounded by the per-tenant cap, which `forTenant` also applies, so `total`
 * is every flow the tenant has: one indexed query, no cursor. The clients
 * naming each flow come from one grouped read over the index that holds only
 * the clients that name one.
 */
export async function listFlows(tx: TenantScopedDatabase, tenantId: string): Promise<FlowListView> {
  const all = await flowRepository(tx).forTenant(tenantId);
  const usage = await clientOidcConfigRepository(tx).flowUsage(tenantId);
  return {
    items: all.map((flow) => ({ ...flowWireShape(flow), client_count: usage.get(flow.id) ?? 0 })),
    total: all.length,
    available: registeredAuthenticatorNames(),
  };
}

export type ReadFlowOutcome = { kind: 'not_found' } | { kind: 'ok'; flow: FlowWire; etag: string };

export async function readFlow(
  tx: TenantScopedDatabase,
  tenantId: string,
  flowId: string,
): Promise<ReadFlowOutcome> {
  const found = await flowRepository(tx).byId(tenantId, flowId);
  if (found === null) return { kind: 'not_found' };
  const flow = flowWireShape(found);
  return { kind: 'ok', flow, etag: etagOf(flow) };
}

interface FlowActor {
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface CreateFlowInput extends FlowActor {
  readonly tenantId: string;
  readonly name: string;
  readonly steps: FlowStep[];
}

export type CreateFlowOutcome =
  | StepsRefusal
  | { kind: 'flow_limit'; limit: number }
  | { kind: 'ok'; flow: FlowWire; etag: string };

/**
 * The cap is counted inside the transaction, under the tenant's flow lock, so
 * two creates at one short of the cap cannot both pass. A name already
 * taken fails on the table's unique constraint, which the route maps.
 */
export async function createFlow(
  tx: TenantScopedDatabase,
  deps: ReplaceFlowDeps,
  input: CreateFlowInput,
): Promise<CreateFlowOutcome> {
  const refusal = refuseSteps(input.steps);
  if (refusal !== null) return refusal;

  const repository = flowRepository(tx);
  await repository.lockForTenant(input.tenantId);
  if ((await repository.countForTenant(input.tenantId)) >= FLOW_LIMIT) {
    return { kind: 'flow_limit', limit: FLOW_LIMIT };
  }

  const created = await repository.create(input.tenantId, input.name, input.steps);
  const flow = flowWireShape(created);
  await deps.audit(tx, {
    action: 'flow.create',
    resourceType: 'flow',
    resourceId: created.id,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: createdDetail('flow', flow),
  });
  return { kind: 'ok', flow, etag: etagOf(flow) };
}

export interface AmendFlowInput extends FlowActor {
  readonly tenantId: string;
  readonly flowId: string;
  readonly name: string;
  readonly steps: FlowStep[];
  readonly ifMatch: string | undefined;
}

export type AmendFlowOutcome =
  | StepsRefusal
  | { kind: 'not_found' }
  | { kind: 'precondition_required' }
  | { kind: 'precondition_failed' }
  | { kind: 'ok'; flow: FlowWire; etag: string };

/** Replaces one flow's name and steps whole; the flag that marks the default is not touched. */
export async function amendFlow(
  tx: TenantScopedDatabase,
  deps: ReplaceFlowDeps,
  input: AmendFlowInput,
): Promise<AmendFlowOutcome> {
  const refusal = refuseSteps(input.steps);
  if (refusal !== null) return refusal;

  const repository = flowRepository(tx);
  await repository.lockForTenant(input.tenantId);
  const before = await repository.byId(input.tenantId, input.flowId);
  if (before === null) return { kind: 'not_found' };
  const beforeWire = flowWireShape(before);
  const precondition = requiredPrecondition(input.ifMatch, etagOf(beforeWire));
  if (precondition !== 'ok') {
    return precondition === 'required'
      ? { kind: 'precondition_required' }
      : { kind: 'precondition_failed' };
  }

  const written = await repository.replace(input.tenantId, input.flowId, input.name, input.steps);
  if (written === null) return { kind: 'not_found' };
  const flow = flowWireShape(written);
  await deps.audit(tx, {
    action: 'flow.amend',
    resourceType: 'flow',
    resourceId: written.id,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: redactedDiff('flow', beforeWire, flow),
  });
  return { kind: 'ok', flow, etag: etagOf(flow) };
}

export interface DeleteFlowInput extends FlowActor {
  readonly tenantId: string;
  readonly flowId: string;
  readonly ifMatch: string | undefined;
}

export type DeleteFlowOutcome =
  | { kind: 'not_found' }
  | { kind: 'precondition_required' }
  | { kind: 'precondition_failed' }
  | { kind: 'default_flow' }
  | { kind: 'in_use'; count: number; sample: readonly string[] }
  | { kind: 'deleted' };

export async function deleteFlow(
  tx: TenantScopedDatabase,
  deps: ReplaceFlowDeps,
  input: DeleteFlowInput,
): Promise<DeleteFlowOutcome> {
  const repository = flowRepository(tx);
  await repository.lockForTenant(input.tenantId);
  const before = await repository.byId(input.tenantId, input.flowId);
  if (before === null) return { kind: 'not_found' };
  const precondition = requiredPrecondition(input.ifMatch, etagOf(flowWireShape(before)));
  if (precondition !== 'ok') {
    return precondition === 'required'
      ? { kind: 'precondition_required' }
      : { kind: 'precondition_failed' };
  }
  if (before.isDefault) return { kind: 'default_flow' };
  // A client pointed at this flow takes the same lock first, so the count is
  // settled; the foreign key still refuses a write that skipped it.
  const usage = await clientOidcConfigRepository(tx).namingFlow(input.tenantId, input.flowId);
  if (usage.count > 0) return { kind: 'in_use', ...usage };
  if (!(await repository.remove(input.tenantId, input.flowId))) return { kind: 'not_found' };

  await deps.audit(tx, {
    action: 'flow.delete',
    resourceType: 'flow',
    resourceId: before.id,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: redactedDiff('flow', flowWireShape(before), null),
  });
  return { kind: 'deleted' };
}

export interface MakeDefaultInput extends FlowActor {
  readonly tenantId: string;
  readonly flowId: string;
  readonly ifMatch: string | undefined;
}

export type MakeDefaultOutcome =
  | { kind: 'not_found' }
  | { kind: 'precondition_required' }
  | { kind: 'precondition_failed' }
  | { kind: 'ok'; flow: FlowWire; etag: string };

/**
 * One transaction under the tenant's flow lock moves the default. The flow
 * that already is the default answers as it is, with no write and no audit
 * row, so a repeated call is harmless.
 */
export async function makeFlowDefault(
  tx: TenantScopedDatabase,
  deps: ReplaceFlowDeps,
  input: MakeDefaultInput,
): Promise<MakeDefaultOutcome> {
  const repository = flowRepository(tx);
  await repository.lockForTenant(input.tenantId);
  const before = await repository.byId(input.tenantId, input.flowId);
  if (before === null) return { kind: 'not_found' };
  const beforeWire = flowWireShape(before);
  const precondition = requiredPrecondition(input.ifMatch, etagOf(beforeWire));
  if (precondition !== 'ok') {
    return precondition === 'required'
      ? { kind: 'precondition_required' }
      : { kind: 'precondition_failed' };
  }
  if (before.isDefault) return { kind: 'ok', flow: beforeWire, etag: etagOf(beforeWire) };

  const made = await repository.makeDefault(input.tenantId, input.flowId);
  if (made === null) return { kind: 'not_found' };
  const flow = flowWireShape(made);
  await deps.audit(tx, {
    action: 'flow.default_set',
    resourceType: 'flow',
    resourceId: made.id,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: redactedDiff('flow', beforeWire, flow),
  });
  return { kind: 'ok', flow, etag: etagOf(flow) };
}
