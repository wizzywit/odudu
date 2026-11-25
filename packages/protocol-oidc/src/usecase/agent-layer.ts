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
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tokenGrantRepository } from '#/repository/grants';
import {
  actorAdmission,
  instanceExpiry,
  mayActClaim,
  mintRefusal,
  normaliseScope,
  type MayActClaim,
  type MintInvariant,
  type MintRefusalError,
} from '#/service/agent-mint';
import { isLive } from '#/usecase/acting-instance';
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
  // A run's instance: it keeps the id the caller derived for the run and
  // lasts at most as long as the session, subject to the idle limit and the
  // parent's expiry, with an idle expiry that slides on use, rather than the
  // fixed lifetime an exchange's gets. A grant with no session bounds it at
  // SESSIONLESS_RUN_SECONDS.
  run?: { instanceId: string; idleSeconds: number };
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function refuse(invariant: MintInvariant): AgentLayerOutcome {
  return { kind: 'refused', error: mintRefusal(invariant).error, invariant };
}

// Who the subject token names as its current actor, the outermost `act`, if it
// names a well-formed one.
function headOfAct(act: unknown): string | null {
  if (typeof act !== 'object' || act === null) return null;
  const sub = (act as { sub?: unknown }).sub;
  return typeof sub === 'string' ? sub : null;
}

// The absolute lifetime of a run's instance on a grant with no session, fixed
// when it is minted.
export const SESSIONLESS_RUN_SECONDS = 86_400;

// The most exchange hops walked back to the grant a person signed in with.
const MAX_GRANT_HOPS = 16;

// The client the person signed in through: the grant at the root of the
// exchange chain, whose configured actors and delegations bound who may act.
async function signInClient(
  tx: TenantScopedDatabase,
  grantId: string,
): Promise<ClientRecord | null> {
  let id = grantId;
  for (let hop = 0; hop < MAX_GRANT_HOPS; hop += 1) {
    const grant = await tokenGrantRepository(tx).byId(id);
    if (grant === null) return null;
    if (grant.exchangedFromGrantId === null) return clientRepository(tx).byId(grant.clientId);
    id = grant.exchangedFromGrantId;
  }
  return null;
}

// Whether the exchanging client may act now, from the sign-in client's own
// configuration and the owner's live delegations, never from a claim alone.
async function liveCeiling(
  tx: TenantScopedDatabase,
  input: AgentLayerInput,
  rootGrantId: string,
): Promise<{ kind: 'ok'; ceiling: string[] | null } | { kind: 'refused' }> {
  const source = await signInClient(tx, rootGrantId);
  if (source === null) return { kind: 'refused' };
  const config = await clientOidcConfigRepository(tx).byClientId(source.id);
  const configured = config?.delegatedActors ?? [];
  const delegations = agentDelegationRepository(tx);
  const own = await delegations.activeForActor(
    input.subject.subjectId,
    source.id,
    input.client.id,
    input.now,
  );
  const anyLive = await delegations.hasActive(input.subject.subjectId, source.id, input.now);
  return actorAdmission({
    namedByConfig: configured.includes(input.client.clientId),
    ceilings: own.map((delegation) => delegation.scopeCeiling),
    liveActors: configured.length + (anyLive ? 1 : 0),
    claimPresent: input.subject.mayAct !== undefined,
  });
}

// Null for a grant no session bounds; 'gone' when the session it names has
// ended or vanished, in which case nothing may be minted from it.
async function sessionEnd(
  tx: TenantScopedDatabase,
  deps: AgentLayerDeps,
  subject: ResolvedExchangeToken,
  now: Date,
): Promise<Date | null | 'gone'> {
  if (subject.sessionId === null) return null;
  const session = await sessionRepository(tx).liveById(subject.sessionId, deps.lifespans, now);
  return session?.expiresAt ?? 'gone';
}

interface Parent {
  node: AgentNode;
  instanceId: string | null;
  rootGrantId: string;
  expiresAt: Date;
  // What the parent instance has left to spend; null for a lineage that starts
  // at a grant, whose limits come from the tenant's settings.
  remaining: { mutating: number; creates: number } | null;
}

// Takes the row lock a mint serialises on, then counts what is already
// there, so two exchanges under the same parent cannot both take its last
// free slot. The tenant's live-instance cap is checked without a lock of its
// own and can be exceeded by the number of mints in flight at once.
// Lock order, here and in every transaction that touches both: the grant
// first, the instance second, which is the order a revoke takes them in.
// A head that looks like an instance id must be a live instance of this client
// in this tenant; only no head, or the client's own id, starts a new lineage.
async function resolveParent(
  tx: TenantScopedDatabase,
  input: AgentLayerInput,
): Promise<Parent | null> {
  const repo = agentInstanceRepository(tx);
  const { subject, client, now } = input;
  const head = headOfAct(subject.act);
  if (subject.act !== undefined && head === null) return null;

  if (head !== null && head !== client.clientId && UUID.test(head)) {
    if (subject.grantId !== null && !(await tokenGrantRepository(tx).lockLive(subject.grantId))) {
      return null;
    }
    const parent = await repo.lockForUpdate(head);
    if (parent?.agentClientId !== client.id || !isLive(parent, now)) return null;
    if (parent.ownerSubjectId !== subject.subjectId) return null;
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
      remaining: {
        mutating: Math.max(parent.sliceMutating - parent.spentMutating, 0),
        creates: Math.max(parent.sliceCreates - parent.spentCreates, 0),
      },
    };
  }
  if (head !== null && head !== client.clientId) return null;

  if (subject.grantId === null || !(await repo.lockGrant(subject.grantId))) return null;
  const expiresAt = subject.expiresAt ?? new Date(now.getTime() + 3_600_000);
  // The client's own marker is a link of the `act` chain the new instance joins,
  // so it counts as a level, as `buildActChain` counts it.
  return {
    node: {
      scope: [...subject.scope],
      expiresAt,
      depth: head === null ? 0 : 1,
      liveChildren: await repo.liveRoots(subject.grantId, now),
    },
    instanceId: null,
    rootGrantId: subject.grantId,
    expiresAt,
    remaining: null,
  };
}

// An exchange's instance lives for the tenant's TTL. A run's is bounded by the
// session and the parent alone, which `instanceExpiry` applies, so its TTL is
// only as long as the session has left.
function lifetimeSeconds(
  input: AgentLayerInput,
  tenantTtlSeconds: number,
  sessionEndsAt: Date | null,
): number {
  if (input.run === undefined) return tenantTtlSeconds;
  if (sessionEndsAt === null) return SESSIONLESS_RUN_SECONDS;
  return (sessionEndsAt.getTime() - input.now.getTime()) / 1000;
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

  const parent = await resolveParent(tx, input);
  if (parent === null) return refuse('parent_not_live');

  const actor = await liveCeiling(tx, input, parent.rootGrantId);
  if (actor.kind === 'refused') return refuse('actor_not_permitted');
  const ceiling = actor.ceiling;
  const bounded: AgentNode =
    ceiling === null
      ? parent.node
      : { ...parent.node, scope: parent.node.scope.filter((entry) => ceiling.includes(entry)) };

  const settings = await readAgentSettings(tx, deps.tenantId);
  const sessionEndsAt = await sessionEnd(tx, deps, input.subject, input.now);
  if (sessionEndsAt === 'gone') return refuse('parent_not_live');
  const expiresAt = instanceExpiry({
    now: input.now,
    ttlSeconds: lifetimeSeconds(input, settings.agentInstanceTtlSeconds, sessionEndsAt),
    parentExpiresAt: parent.expiresAt,
    sessionEndsAt,
  });
  if (expiresAt === null) return refuse('invalid_expiry');
  const maxDepth = Math.min(settings.agentMaxDelegationDepth, STRUCTURAL_MAX_DEPTH);
  const admission = admitChild(
    bounded,
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
    id: input.run?.instanceId ?? newId(),
    tenantId: deps.tenantId,
    ownerSubjectId: input.subject.subjectId,
    agentClientId: input.client.id,
    parentInstanceId: parent.instanceId,
    rootGrantId: parent.rootGrantId,
    depth: admission.node.depth,
    scope: scope.join(' '),
    expiresAt,
    slice: parent.remaining ?? {
      mutating: settings.agentWritesPerGrant,
      creates: settings.agentCreatesPerGrant,
    },
    idleExpiresAt:
      input.run === undefined
        ? null
        : new Date(
            Math.min(input.now.getTime() + input.run.idleSeconds * 1000, expiresAt.getTime()),
          ),
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
// Without either, no claim is made and today's rule (anyone may) stands. Past
// the newest 200 delegations an older actor is left out of the claim, which
// refuses it rather than admitting it.
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
  const actors = await clientRepository(tx).byIds(
    delegations.map((delegation) => delegation.actorClientId),
  );
  const named = actors.map((actor) => actor.clientId);
  return mayActClaim([...input.delegatedActors, ...named], input.issuer);
}
