import {
  executionRepository,
  registeredAuthenticatorNames,
  startsALogin,
  type AuthenticationExecutionRecord,
  type ExecutionInput,
} from '@odudu/authn-flows';
import { type ExecutionStep } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
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

export async function listFlow(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<readonly ExecutionStep[]> {
  const rows = await executionRepository(tx).forTenant(tenantId);
  return rows.map(toWireShape);
}

export interface ReplaceFlowInput {
  readonly tenantId: string;
  readonly steps: ExecutionInput[];
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
  | { kind: 'ok'; items: readonly ExecutionStep[] };

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

  return { kind: 'ok', items: rows.map(toWireShape) };
}
