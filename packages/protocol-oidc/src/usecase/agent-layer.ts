import { sessionRepository, type SessionLifespans } from '@odudu/authn-flows';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  admitChild,
  agentDelegationRepository,
  agentInstanceRepository,
  STRUCTURAL_MAX_DEPTH,
  type AgentInstanceRecord,
  type AgentNode,
} from '@odudu/domain-agents';
import { auditRepository } from '@odudu/domain-audit';
import { clientRepository, readAgentSettings, type ClientRecord } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import {
  instanceExpiry,
  mayActClaim,
  mintRefusal,
  narrowestCeiling,
  normaliseScope,
  type MayActClaim,
  type MintInvariant,
  type MintRefusalError,
} from '#/service/agent-mint';
import { type ResolvedExchangeToken } from '#/usecase/token-exchange-subject';

export interface AgentLayerDeps {
  tenantId: string;
  lifespans: SessionLifespans;
}

export interface AgentLayerInput {
  client: ClientRecord;
  // The exchanging client's `agent_type`, which lives with its OIDC
  // configuration rather than on `ClientRecord`.
  agentType: boolean;
  subject: ResolvedExchangeToken;
  actorSubject: string;
  requestedScope: readonly string[];
  now: Date;
}

export type AgentLayerOutcome =
  | {
      kind: 'ok';
      actorSub: string;
      instance: AgentInstanceRecord | null;
      scope: readonly string[];
      // The tenant's limit on an `act` chain, present when an instance was minted.
      maxDepth?: number;
    }
  | { kind: 'refused'; error: MintRefusalError; invariant: MintInvariant };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function refuse(invariant: MintInvariant): AgentLayerOutcome {
  return { kind: 'refused', error: mintRefusal(invariant).error, invariant };
}

// The innermost-first `act` chain's head: who the subject token already
// names as acting, if it names a well-formed one.
function headOfAct(act: unknown): string | null {
  if (typeof act !== 'object' || act === null) return null;
  const sub = (act as { sub?: unknown }).sub;
  return typeof sub === 'string' ? sub : null;
}

function isLive(instance: AgentInstanceRecord, now: Date): boolean {
  return (
    instance.revokedAt === null &&
    instance.expiresAt.getTime() > now.getTime() &&
    (instance.idleExpiresAt === null || instance.idleExpiresAt.getTime() > now.getTime())
  );
}

// What the subject's delegations to the exchanging client allow, or null when
// no delegation names it and the client's own configuration is the only grant.
async function delegationCeiling(
  tx: TenantScopedDatabase,
  input: AgentLayerInput,
): Promise<string[] | null> {
  const delegations = await agentDelegationRepository(tx).activeFor(
    input.subject.subjectId,
    input.subject.clientDbId,
    input.now,
  );
  return narrowestCeiling(
    delegations
      .filter((delegation) => delegation.actorClientId === input.client.id)
      .map((delegation) => delegation.scopeCeiling),
  );
}

async function sessionEnd(
  tx: TenantScopedDatabase,
  deps: AgentLayerDeps,
  subject: ResolvedExchangeToken,
  now: Date,
): Promise<Date | null> {
  if (subject.sessionId === null) return null;
  const session = await sessionRepository(tx).liveById(subject.sessionId, deps.lifespans, now);
  return session?.expiresAt ?? now;
}

interface Parent {
  node: AgentNode;
  instanceId: string | null;
  rootGrantId: string;
  expiresAt: Date;
}

// Takes the row lock a mint serialises on, then counts what is already
// there, so two exchanges at the last free slot cannot both be admitted.
async function resolveParent(
  tx: TenantScopedDatabase,
  input: AgentLayerInput,
  ceiling: string[] | null,
): Promise<Parent | null> {
  const repo = agentInstanceRepository(tx);
  const { subject, client, now } = input;
  const scope =
    ceiling === null
      ? [...subject.scope]
      : subject.scope.filter((entry) => ceiling.includes(entry));
  const head = headOfAct(subject.act);
  const named = head !== null && UUID.test(head) ? await repo.byId(head) : null;

  if (named !== null) {
    const parent = await repo.lockForUpdate(named.id);
    if (parent === null || parent.agentClientId !== client.id || !isLive(parent, now)) return null;
    return {
      node: {
        scope: parent.scope.split(' ').filter((entry) => entry !== ''),
        expiresAt: parent.expiresAt,
        depth: parent.depth,
        liveChildren: await repo.liveChildren(parent.id, now),
      },
      instanceId: parent.id,
      rootGrantId: parent.rootGrantId,
      expiresAt: parent.expiresAt,
    };
  }

  if (subject.grantId === null || !(await repo.lockGrant(subject.grantId))) return null;
  const expiresAt = subject.expiresAt ?? new Date(now.getTime() + 3_600_000);
  return {
    node: { scope, expiresAt, depth: 0, liveChildren: await repo.liveRoots(subject.grantId, now) },
    instanceId: null,
    rootGrantId: subject.grantId,
    expiresAt,
  };
}

// Stage 4 for an agent-type client: mints the instance that becomes `act.sub`.
// A client that is not an agent type is returned unchanged and nothing is read.
export async function applyAgentLayer(
  tx: TenantScopedDatabase,
  deps: AgentLayerDeps,
  input: AgentLayerInput,
): Promise<AgentLayerOutcome> {
  if (!input.agentType) {
    return {
      kind: 'ok',
      actorSub: input.actorSubject,
      instance: null,
      scope: input.requestedScope,
    };
  }

  const scope = normaliseScope(input.requestedScope);
  if (scope === null) return refuse('scope_widened');

  const ceiling = await delegationCeiling(tx, input);
  const parent = await resolveParent(tx, input, ceiling);
  if (parent === null) return refuse('parent_not_live');

  const settings = await readAgentSettings(tx, deps.tenantId);
  const sessionEndsAt = await sessionEnd(tx, deps, input.subject, input.now);
  const expiresAt = instanceExpiry({
    now: input.now,
    ttlSeconds: settings.agentInstanceTtlSeconds,
    parentExpiresAt: parent.expiresAt,
    sessionEndsAt,
  });
  const maxDepth = Math.min(settings.agentMaxDelegationDepth, STRUCTURAL_MAX_DEPTH);
  const admission = admitChild(
    parent.node,
    { scope, expiresAt },
    {
      maxDepth,
      maxChildren: settings.agentMaxChildren,
      sessionEndsAt: sessionEndsAt ?? expiresAt,
    },
  );
  if (admission.kind === 'refused') return refuse(admission.invariant);

  const repo = agentInstanceRepository(tx);
  if ((await repo.liveCount(input.now)) >= settings.agentMaxLiveInstances) {
    return refuse('live_instances_exceeded');
  }

  const instance = await repo.mint({
    id: newId(),
    tenantId: deps.tenantId,
    ownerSubjectId: input.subject.subjectId,
    agentClientId: input.client.id,
    parentInstanceId: parent.instanceId,
    rootGrantId: parent.rootGrantId,
    depth: admission.node.depth,
    scope: scope.join(' '),
    expiresAt,
    idleExpiresAt: null,
  });
  await auditRepository(tx).record({
    eventType: 'agent_identity',
    action: 'agent.instance_minted',
    outcome: 'allowed',
    actorSubjectId: input.subject.subjectId,
    actorClientId: input.client.id,
    resourceType: 'agent_instance',
    resourceId: instance.id,
    detail: {
      agent_client: input.client.clientId,
      owner: input.subject.subjectId,
      instance: instance.id,
      depth: instance.depth,
    },
  });
  return { kind: 'ok', actorSub: instance.id, instance, scope, maxDepth };
}

// Who may act for `subjectId` in a grant made through `clientDbId`: the
// client's configured actors and the subject's active delegations together.
// Without either, no claim is made and today's rule (anyone may) stands.
export async function mayActFor(
  tx: TenantScopedDatabase,
  input: {
    subjectId: string;
    clientDbId: string;
    delegatedActors: readonly string[];
    issuer: string;
    now: Date;
  },
): Promise<MayActClaim | undefined> {
  const delegations = await agentDelegationRepository(tx).activeFor(
    input.subjectId,
    input.clientDbId,
    input.now,
  );
  const named = await Promise.all(
    delegations.map(async (delegation) => {
      const actor = await clientRepository(tx).byId(delegation.actorClientId);
      return actor?.clientId ?? null;
    }),
  );
  return mayActClaim(
    [...input.delegatedActors, ...named.filter((id): id is string => id !== null)],
    input.issuer,
  );
}
