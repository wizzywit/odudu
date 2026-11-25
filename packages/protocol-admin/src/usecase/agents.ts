import { type ListAgentApprovalsQuery, type ListAgentsQuery } from '@odudu/contracts/admin';
import { withSavepoint, type TenantScopedDatabase } from '@odudu/db';
import {
  agentApprovalRepository,
  agentInstanceRepository,
  type AgentApprovalRecord,
  type AgentInstanceRecord,
} from '@odudu/domain-agents';
import { auditRepository } from '@odudu/domain-audit';
import { userRepository } from '@odudu/domain-identity';
import { clientRepository } from '@odudu/domain-tenant';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
import { idPage, resumeAfter, type IdPageOutcome } from '#/usecase/id-page';
import {
  lockSubjectRow,
  refuseOverTargetCeiling,
  type TargetCeilingInput,
  type TargetCeilingRefusal,
} from '#/usecase/subjects';

export interface AgentInstanceView {
  readonly instance: AgentInstanceRecord;
  readonly agentClient: string;
  readonly ownerUsername: string | null;
}

export interface AgentApprovalView {
  readonly approval: AgentApprovalRecord;
  readonly agentClient: string;
  readonly ownerUsername: string | null;
}

interface PageInput {
  readonly tenantId: string;
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
}

export interface ListAgentsInput extends PageInput {
  readonly filters: Omit<ListAgentsQuery, 'cursor' | 'limit'>;
  readonly now: Date;
}

export interface ListAgentApprovalsInput extends PageInput {
  readonly filters: Omit<ListAgentApprovalsQuery, 'cursor' | 'limit'>;
}

// The `client_id` of each client a page names, in one read for the page.
async function clientKeys(
  tx: TenantScopedDatabase,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const found = await clientRepository(tx).byIds([...new Set(ids)]);
  return new Map(found.map((client) => [client.id, client.clientId]));
}

// The username of each owner a page names, in one read for the page. A subject
// with no username (it was never a person) has none to print.
async function ownerNames(
  tx: TenantScopedDatabase,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  return userRepository(tx).usernamesOf(ids);
}

// A client deleted after a page was read leaves no `client_id` to print, and an
// internal id is not one.
function keyOf(keys: ReadonlyMap<string, string>, id: string): string {
  return keys.get(id) ?? 'unknown';
}

export async function listAgents(
  tx: TenantScopedDatabase,
  input: ListAgentsInput,
): Promise<IdPageOutcome<AgentInstanceView>> {
  const request = {
    collection: 'agents',
    tenantId: input.tenantId,
    filters: { owner: input.filters.owner, state: input.filters.state },
    limit: input.limit,
    cursor: input.cursor,
    cursorKey: input.cursorKey,
  };
  const resume = resumeAfter(request);
  if (resume.kind === 'invalid') return { kind: 'invalid_cursor' };
  const rows = await agentInstanceRepository(tx).page({
    ...(input.filters.owner === undefined ? {} : { ownerSubjectId: input.filters.owner }),
    ...(input.filters.state === undefined ? {} : { state: input.filters.state }),
    ...(resume.after === undefined ? {} : { afterId: resume.after }),
    limit: input.limit + 1,
    now: input.now,
  });
  const keys = await clientKeys(
    tx,
    rows.map((row) => row.agentClientId),
  );
  const owners = await ownerNames(
    tx,
    rows.map((row) => row.ownerSubjectId),
  );
  return idPage(
    request,
    rows.map((instance) => ({
      id: instance.id,
      instance,
      agentClient: keyOf(keys, instance.agentClientId),
      ownerUsername: owners.get(instance.ownerSubjectId) ?? null,
    })),
  );
}

export async function readAgent(
  tx: TenantScopedDatabase,
  id: string,
): Promise<AgentInstanceView | null> {
  const instance = await agentInstanceRepository(tx).byId(id);
  if (instance === null) return null;
  const keys = await clientKeys(tx, [instance.agentClientId]);
  const owners = await ownerNames(tx, [instance.ownerSubjectId]);
  return {
    instance,
    agentClient: keyOf(keys, instance.agentClientId),
    ownerUsername: owners.get(instance.ownerSubjectId) ?? null,
  };
}

export async function listAgentApprovals(
  tx: TenantScopedDatabase,
  input: ListAgentApprovalsInput,
): Promise<IdPageOutcome<AgentApprovalView>> {
  const request = {
    collection: 'agent-approvals',
    tenantId: input.tenantId,
    filters: { state: input.filters.state },
    limit: input.limit,
    cursor: input.cursor,
    cursorKey: input.cursorKey,
  };
  const resume = resumeAfter(request);
  if (resume.kind === 'invalid') return { kind: 'invalid_cursor' };
  const rows = await agentApprovalRepository(tx).page({
    ...(input.filters.state === undefined ? {} : { state: input.filters.state }),
    ...(resume.after === undefined ? {} : { beforeId: resume.after }),
    limit: input.limit + 1,
  });
  const keys = await clientKeys(
    tx,
    rows.map((row) => row.requestingClientId),
  );
  const owners = await ownerNames(
    tx,
    rows.map((row) => row.subjectId),
  );
  return idPage(
    request,
    rows.map((approval) => ({
      id: approval.id,
      approval,
      agentClient: keyOf(keys, approval.requestingClientId),
      ownerUsername: owners.get(approval.subjectId) ?? null,
    })),
  );
}

export interface AgentAuditEvent {
  readonly action: 'agent.instance_revoke';
  readonly resourceType: 'agent_instance';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused';
  readonly detail: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: AgentAuditEvent) => Promise<void>;

export interface RevokeAgentInput {
  readonly instanceId: string;
  readonly dryRun: boolean;
  readonly now: Date;
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export type RevokeAgentOutcome =
  | { kind: 'not_found' }
  | TargetCeilingRefusal
  | { kind: 'revoked'; grants: number; instances: number };

// Thrown to roll a dry run back; carries what the run counted.
class RolledBack<T> extends Error {
  readonly value: T;

  constructor(value: T) {
    super('rolled back');
    this.value = value;
  }
}

// Runs `work` and undoes every write it made, answering what it returned. The
// counts of a dry run are the counts of the revocation itself, because it is the
// same code, and nothing it wrote, the audit rows included, survives.
async function undone<T>(
  tx: TenantScopedDatabase,
  work: (inner: TenantScopedDatabase) => Promise<T>,
): Promise<T> {
  try {
    await withSavepoint(tx, async (inner) => {
      throw new RolledBack(await work(inner));
    });
  } catch (error) {
    if (error instanceof RolledBack) return error.value as T;
    throw error;
  }
  throw new Error('a dry run ended without rolling back');
}

interface Ended {
  readonly grants: number;
  readonly instances: number;
}

// A depth of at most 8 and a revoked parent that refuses a new child leave a
// handful of passes at most; one past that means something keeps minting.
const MAX_PASSES = 16;

// Grants first, then instances: the order a mint locks its rows in, so the two
// cannot wait on each other. The tree is read again after each pass until one
// ends nothing, so a child that committed while an earlier pass waited on a
// row lock, and the grants it acted in, are found by a later pass. The
// lineage row is written only when an instance was revoked from the top.
async function endTree(
  tx: TenantScopedDatabase,
  instance: AgentInstanceRecord,
  agentClient: string,
  input: RevokeAgentInput,
): Promise<Ended> {
  const instances = agentInstanceRepository(tx);
  const grants = tokenGrantRepository(tx);
  const total = { grants: 0, instances: 0 };
  let ended = 0;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const tree = await instances.subtree(instance.id);
    const below = await grants.revokeForActors(tree, input.now);
    const revoked = await instances.revoke(instance.id, input.now);
    total.grants += below.grants;
    total.instances += below.instances + revoked;
    ended += revoked;
    if (below.grants === 0 && below.instances === 0 && revoked === 0) {
      if (ended > 0) await recordInstanceRevoked(tx, instance, agentClient, ended);
      return total;
    }
  }
  throw new Error(`revoking agent instance ${instance.id} did not settle`);
}

async function recordInstanceRevoked(
  tx: TenantScopedDatabase,
  instance: AgentInstanceRecord,
  agentClient: string,
  count: number,
): Promise<void> {
  await auditRepository(tx).record({
    eventType: 'agent_identity',
    action: 'agent.instance_revoked',
    outcome: 'allowed',
    actorSubjectId: instance.ownerSubjectId,
    actorClientId: instance.agentClientId,
    resourceType: 'agent_instance',
    resourceId: instance.id,
    detail: {
      agent_client: agentClient,
      owner: instance.ownerSubjectId,
      instance: instance.id,
      depth: instance.depth,
      count,
      via: 'admin',
    },
  });
}

// Revokes the instance and everything beneath it, and the grants any of them
// acted in with what was exchanged from those. An owner holding an admin
// capability the caller does not is out of reach (ADR 0040). With `dryRun` it
// answers the same counts and changes nothing.
export async function revokeAgent(
  tx: TenantScopedDatabase,
  deps: { readonly audit: Audit },
  input: RevokeAgentInput,
): Promise<RevokeAgentOutcome> {
  const view = await readAgent(tx, input.instanceId);
  if (view === null) return { kind: 'not_found' };
  const { instance, agentClient } = view;

  const run = async (inner: TenantScopedDatabase): Promise<RevokeAgentOutcome> => {
    if (!(await lockSubjectRow(inner, instance.ownerSubjectId))) return { kind: 'not_found' };
    const target: TargetCeilingInput = { ...input, subjectId: instance.ownerSubjectId };
    const refused = await refuseOverTargetCeiling(
      inner,
      deps.audit,
      'agent.instance_revoke',
      target,
      { type: 'agent_instance', id: instance.id },
    );
    if (refused !== null) return refused;
    const ended = await endTree(inner, instance, agentClient, input);
    if (ended.grants > 0 || ended.instances > 0) {
      await deps.audit(inner, {
        action: 'agent.instance_revoke',
        resourceType: 'agent_instance',
        resourceId: instance.id,
        actorSubjectId: input.actorSubjectId,
        actorTenantId: input.actorTenantId,
        actorClientId: input.actorClientId,
        outcome: 'allowed',
        detail: { grants: ended.grants, instances: ended.instances },
      });
    }
    return { kind: 'revoked', ...ended };
  };
  return input.dryRun ? undone(tx, run) : run(tx);
}
