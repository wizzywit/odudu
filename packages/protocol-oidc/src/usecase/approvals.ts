import { type TenantScopedDatabase } from '@odudu/db';
import {
  agentApprovalRepository,
  agentInstanceRepository,
  type AgentApprovalChannel,
  type AgentApprovalRecord,
  type AgentInstanceRecord,
} from '@odudu/domain-agents';
import { auditRepository } from '@odudu/domain-audit';
import { readAgentSettings } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';

export const PENDING_APPROVALS_PER_SUBJECT = 20;

export class ApprovalLimitReached extends Error {
  constructor() {
    super(`a subject holds at most ${String(PENDING_APPROVALS_PER_SUBJECT)} pending approvals`);
    this.name = 'ApprovalLimitReached';
  }
}

// The instance an approval names is missing, ended, or belongs to someone else.
export class ApprovalInstanceRefused extends Error {
  constructor() {
    super('an approval can name only a live instance of its own owner');
    this.name = 'ApprovalInstanceRefused';
  }
}

function liveOwnedBy(instance: AgentInstanceRecord, subjectId: string, now: Date): boolean {
  return (
    instance.ownerSubjectId === subjectId &&
    instance.revokedAt === null &&
    instance.expiresAt > now &&
    (instance.idleExpiresAt === null || instance.idleExpiresAt > now)
  );
}

export interface ApprovalDeps {
  readonly tenantId: string;
}

export interface ApprovalRequest {
  // The owner who is asked to decide.
  readonly subjectId: string;
  readonly requestingClientId: string;
  readonly instanceId: string | null;
  readonly kind: string;
  readonly summary: string;
  readonly actionDigest: string;
  // Asks for less than the tenant's lifetime; never more.
  readonly lifetimeSeconds?: number;
  readonly now: Date;
}

// Asks an owner to approve one action. It expires with the tenant's approval
// ttl, or with the instance that asked if that ends sooner.
export async function requestApproval(
  tx: TenantScopedDatabase,
  deps: ApprovalDeps,
  input: ApprovalRequest,
): Promise<AgentApprovalRecord> {
  // Serialises requests per owner so two at the cap cannot both pass the count.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`agent-approvals:${input.subjectId}`}))`,
  );
  const repository = agentApprovalRepository(tx);
  if (
    (await repository.pendingCount(input.subjectId, input.now)) >= PENDING_APPROVALS_PER_SUBJECT
  ) {
    throw new ApprovalLimitReached();
  }

  let instanceEnd: Date | null = null;
  if (input.instanceId !== null) {
    const instance = await agentInstanceRepository(tx).byId(input.instanceId);
    if (instance === null || !liveOwnedBy(instance, input.subjectId, input.now)) {
      throw new ApprovalInstanceRefused();
    }
    instanceEnd = instance.expiresAt;
  }

  const settings = await readAgentSettings(tx, deps.tenantId);
  const lifetime = Math.min(settings.agentApprovalTtlSeconds, input.lifetimeSeconds ?? Infinity);
  const ttlEnd = new Date(input.now.getTime() + lifetime * 1000);
  const expiresAt = instanceEnd !== null && instanceEnd < ttlEnd ? instanceEnd : ttlEnd;

  const record = await repository.create({
    id: newId(),
    tenantId: deps.tenantId,
    subjectId: input.subjectId,
    requestingClientId: input.requestingClientId,
    instanceId: input.instanceId,
    kind: input.kind,
    summary: input.summary,
    actionDigest: input.actionDigest,
    expiresAt,
  });
  await auditRepository(tx).record({
    eventType: 'agent_identity',
    action: 'agent.approval_requested',
    outcome: 'allowed',
    actorSubjectId: input.subjectId,
    actorClientId: input.requestingClientId,
    resourceType: 'agent_approval',
    resourceId: record.id,
    detail: {
      agent_client: input.requestingClientId,
      owner: input.subjectId,
      approval: record.id,
      ...(input.instanceId === null ? {} : { instance: input.instanceId }),
    },
  });
  return record;
}

export interface ApprovalDecision {
  readonly approvalId: string;
  // The authenticated person deciding, never a value an agent supplies.
  readonly subjectId: string;
  readonly approve: boolean;
  readonly via: AgentApprovalChannel;
  readonly now: Date;
}

export type ApprovalDecisionOutcome = 'decided' | 'not_pending' | 'not_owner';

// The only function that moves an approval out of `pending`; the CIBA consent
// page and the console both call it. Of two decisions arriving together the
// repository's conditional update lets exactly one through.
export async function decideApproval(
  tx: TenantScopedDatabase,
  _deps: ApprovalDeps,
  input: ApprovalDecision,
): Promise<ApprovalDecisionOutcome> {
  const repository = agentApprovalRepository(tx);
  const approval = await repository.byId(input.approvalId);
  if (approval === null) return 'not_pending';
  if (approval.subjectId !== input.subjectId) return 'not_owner';

  const state = input.approve ? 'approved' : 'denied';
  if (!(await repository.decide(approval.id, state, input.via, input.now))) return 'not_pending';

  await auditRepository(tx).record({
    eventType: 'agent_identity',
    action: 'agent.approval_decided',
    outcome: 'allowed',
    actorSubjectId: input.subjectId,
    resourceType: 'agent_approval',
    resourceId: approval.id,
    detail: { owner: input.subjectId, approval: approval.id, state, via: input.via },
  });
  return 'decided';
}

// Spends an approved approval for the action its digest names, once.
export function consumeApproval(
  tx: TenantScopedDatabase,
  id: string,
  digest: string,
  now: Date,
): Promise<boolean> {
  return agentApprovalRepository(tx).consume(id, digest, now);
}
