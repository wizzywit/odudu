import {
  executionRepository,
  registeredAuthenticatorNames,
  startsALogin,
  type AuthenticationExecutionRecord,
  type ExecutionInput,
} from '@odudu/authn-flows';
import { type ExecutionStep } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { etagOf, requiredPrecondition } from '#/service/etag';
import { validateFlowSteps } from '#/service/flow-validation';

export interface FlowAuditEvent {
  readonly action: 'flow.replace';
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

function toWireShape(record: AuthenticationExecutionRecord): ExecutionStep {
  return {
    index: record.index,
    authenticator: record.authenticator,
    requirement: record.requirement,
  };
}

export interface FlowView {
  readonly items: readonly ExecutionStep[];
  readonly etag: string;
}

/** `forTenant` reads in `index` order, which is the flow's meaning, so the `ETag` needs no sort. */
export async function listFlow(tx: TenantScopedDatabase, tenantId: string): Promise<FlowView> {
  const rows = await executionRepository(tx).forTenant(tenantId);
  const items = rows.map(toWireShape);
  return { items, etag: etagOf({ items }) };
}

export interface ReplaceFlowInput {
  readonly tenantId: string;
  readonly steps: ExecutionInput[];
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface ReplaceFlowDeps {
  readonly audit: Audit;
}

export type ReplaceFlowOutcome =
  | { kind: 'empty' }
  | { kind: 'unresolvable_authenticator'; name: string; known: readonly string[] }
  | { kind: 'no_enabled_step' }
  | { kind: 'no_step_runnable_at_start' }
  | { kind: 'precondition_required' }
  | { kind: 'precondition_failed' }
  | { kind: 'ok'; items: readonly ExecutionStep[]; etag: string };

/** Replaces a tenant's whole flow — no partial edit is offered, since a flow's meaning is in its order. */
export async function replaceFlow(
  tx: TenantScopedDatabase,
  deps: ReplaceFlowDeps,
  input: ReplaceFlowInput,
): Promise<ReplaceFlowOutcome> {
  const validated = validateFlowSteps(input.steps, registeredAuthenticatorNames());
  if (validated.kind !== 'ok') return validated;
  // Shape is not enough: a flow every step of which stands down before any
  // subject is bound passes every check above and still cannot render a
  // first challenge.
  if (!startsALogin(input.steps)) return { kind: 'no_step_runnable_at_start' };

  // Before the read, never after: the lock is what makes the comparison
  // below describe the flow this write overwrites, the same order
  // `amendSettings` and `amendClient` take theirs in.
  await executionRepository(tx).lockForTenant(input.tenantId);
  const before = await listFlow(tx, input.tenantId);
  const precondition = requiredPrecondition(input.ifMatch, before.etag);
  if (precondition !== 'ok') {
    return precondition === 'required'
      ? { kind: 'precondition_required' }
      : { kind: 'precondition_failed' };
  }

  const rows = await executionRepository(tx).replaceForTenant(input.tenantId, input.steps);

  await deps.audit(tx, {
    action: 'flow.replace',
    resourceType: 'flow',
    resourceId: input.tenantId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  const items = rows.map(toWireShape);
  return { kind: 'ok', items, etag: etagOf({ items }) };
}
