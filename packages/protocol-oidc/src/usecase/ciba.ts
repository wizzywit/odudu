import { findAccountByLogin } from '@odudu/authn-flows';
import { type TenantScopedDatabase } from '@odudu/db';
import { approvalDigest } from '@odudu/domain-agents';
import { auditRepository } from '@odudu/domain-audit';
import { subjectIsEnabled, subjectRepository } from '@odudu/domain-identity';
import { clientScopeRepository, readAgentSettings, type ClientRecord } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { cibaRequestRepository } from '#/repository/ciba-requests';
import { type ClientOidcConfig } from '#/repository/client-oidc-config';
import { clientSecretLimiterKey, type ClientSecretLimiter } from '#/service/client-secret-throttle';
import {
  CIBA_GRANT,
  CIBA_INTERVAL_SECONDS,
  generateAuthReqId,
  hashAuthReqId,
  hintDigest,
  parseBackchannelRequest,
  type BackchannelRequest,
} from '#/service/ciba';
import {
  invalidBindingMessage,
  invalidRequest,
  invalidScope,
  refusedByServer,
  TokenRateLimited,
  unauthorizedClient,
  withAudit,
  type TokenRefusalAudit,
} from '#/service/errors';
import { resolveScope } from '#/service/scope';
import {
  ApprovalLimitReached,
  PENDING_APPROVALS_PER_SUBJECT,
  requestApproval,
} from '#/usecase/approvals';
import {
  authenticateEndpointClient,
  type ClientRequest,
  type EndpointAuthenticationDeps,
} from '#/usecase/private-key-jwt-authentication';
import { subjectOfAuthorizeHint } from '#/usecase/authorization-request';
import { type SigningKeyRecord } from '@odudu/crypto';

export interface BackchannelDeps extends EndpointAuthenticationDeps {
  readonly cibaLimiter: ClientSecretLimiter;
  // Whether the tenant lets a person sign in with a verified address.
  readonly loginWithEmail: boolean;
  readonly listPublishableKeys: (tenantId: string) => Promise<SigningKeyRecord[]>;
}

export interface BackchannelAcknowledgement {
  readonly auth_req_id: string;
  readonly expires_in: number;
  readonly interval: number;
}

const refusal = (client: ClientRecord, reason: TokenRefusalAudit['reason']): TokenRefusalAudit => ({
  action: 'ciba.requested',
  reason,
  clientDbId: client.id,
});

// OpenID CIBA §7. A hint that names nobody is answered as one that names a
// person is (docs/protocols/oidc-ciba.md, "An unknown person is answered as a
// known one is"), so every statement below runs whoever was named.
export async function acknowledgeBackchannelRequest(
  tx: TenantScopedDatabase,
  deps: BackchannelDeps,
  request: ClientRequest,
): Promise<BackchannelAcknowledgement> {
  const { client, config, settle } = await authenticateEndpointClient(tx, deps, request);
  return settle((work) => acknowledge(work, deps, request, client, config));
}

async function acknowledge(
  tx: TenantScopedDatabase,
  deps: BackchannelDeps,
  request: ClientRequest,
  client: ClientRecord,
  config: ClientOidcConfig,
): Promise<BackchannelAcknowledgement> {
  const decision = deps.cibaLimiter.check(clientSecretLimiterKey(deps.tenantId, client.id));
  if (!decision.allowed) {
    throw new TokenRateLimited(decision.retryAfterSeconds, refusal(client, 'rate_limited'));
  }
  if (!config.grantTypes.includes(CIBA_GRANT)) {
    throw withAudit(unauthorizedClient(), refusal(client, 'unauthorized_client'));
  }

  const parsed = parseBackchannelRequest(request.body);
  if (!parsed.ok) {
    if (parsed.error === 'invalid_scope') {
      throw withAudit(invalidScope(), refusal(client, 'invalid_scope'));
    }
    throw parsed.error === 'invalid_binding_message' ? invalidBindingMessage() : invalidRequest();
  }
  const asked = parsed.request;

  const assigned = (await clientScopeRepository(tx).forClient(client.id)).map((s) => s.name);
  const requested = asked.scope.split(' ').filter((token) => token.length > 0);
  if (resolveScope(asked.scope, assigned, null, null).length !== requested.length) {
    throw withAudit(invalidScope(), refusal(client, 'invalid_scope'));
  }

  const subjectId = await resolveSubject(tx, deps, client, asked);
  const now = deps.now();
  const digestOfHint = hintDigest(deps.tenantId, asked.hint.value);
  const { approvalId, expiresAt: approvalEnd } =
    subjectId === null
      ? await decoyApproval(tx, deps, client, digestOfHint, now)
      : await openApproval(tx, deps, client, subjectId, asked, now);

  const requestedEnd =
    asked.requestedExpiry === null ? null : new Date(now.getTime() + asked.requestedExpiry * 1000);
  const expiresAt =
    requestedEnd !== null && requestedEnd < approvalEnd ? requestedEnd : approvalEnd;

  const authReqId = generateAuthReqId();
  await cibaRequestRepository(tx).create({
    id: newId(),
    tenantId: deps.tenantId,
    authReqHash: hashAuthReqId(authReqId),
    clientId: client.id,
    subjectId,
    approvalId,
    hintDigest: digestOfHint,
    scope: requested.join(' '),
    bindingMessage: asked.bindingMessage,
    requestedExpiry: asked.requestedExpiry,
    expiresAt,
  });
  await auditRepository(tx).record({
    eventType: 'agent_identity',
    action: 'ciba.requested',
    outcome: 'allowed',
    actorSubjectId: subjectId,
    actorClientId: client.id,
    resourceType: approvalId === null ? null : 'agent_approval',
    resourceId: approvalId,
    detail: {
      agent_client: client.id,
      ...(subjectId === null || approvalId === null
        ? {}
        : { owner: subjectId, approval: approvalId }),
    },
  });

  return {
    auth_req_id: authReqId,
    expires_in: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000)),
    interval: CIBA_INTERVAL_SECONDS,
  };
}

// The person a hint names, or null for nobody: an unknown or disabled person,
// or a hint that names no user. A hint that is not one this server issued to
// this client is refused outright, which says nothing about any person.
async function resolveSubject(
  tx: TenantScopedDatabase,
  deps: BackchannelDeps,
  client: ClientRecord,
  asked: BackchannelRequest,
): Promise<string | null> {
  if (asked.hint.kind === 'login_hint') {
    const found = await findAccountByLogin(tx, asked.hint.value, deps.loginWithEmail);
    return found !== null && subjectIsEnabled(found.subject) ? found.subject.id : null;
  }
  const hint = await subjectOfAuthorizeHint(
    deps,
    deps.tenantId,
    deps.acceptedIssuers,
    asked.hint.value,
    client.clientId,
  );
  if (hint === null) throw invalidRequest();
  const subject = await subjectRepository(tx).byId(hint.subject);
  return subject?.type === 'user' && subjectIsEnabled(subject) ? subject.id : null;
}

// What the approval binds: this client asking for this scope, this message
// and this lifetime on behalf of this owner.
export function cibaActionDigest(
  tenantId: string,
  ownerSubjectId: string,
  client: Pick<ClientRecord, 'clientId'>,
  request: Pick<BackchannelRequest, 'scope' | 'bindingMessage' | 'requestedExpiry'>,
): string {
  try {
    return approvalDigest({
      name: 'ciba',
      input: {
        scope: request.scope,
        binding_message: request.bindingMessage,
        ...(request.requestedExpiry === null ? {} : { requested_expiry: request.requestedExpiry }),
        client_id: client.clientId,
      },
      tenantId,
      ownerSubjectId,
      instanceId: null,
    });
  } catch {
    // Input the digest cannot canonicalise is a request that is not valid.
    throw invalidRequest();
  }
}

async function openApproval(
  tx: TenantScopedDatabase,
  deps: BackchannelDeps,
  client: ClientRecord,
  subjectId: string,
  asked: BackchannelRequest,
  now: Date,
) {
  const requested = asked.scope.split(' ').filter((token) => token.length > 0);
  const digest = cibaActionDigest(deps.tenantId, subjectId, client, {
    ...asked,
    scope: requested.join(' '),
  });
  try {
    const approval = await requestApproval(
      tx,
      { tenantId: deps.tenantId },
      {
        subjectId,
        requestingClientId: client.id,
        instanceId: null,
        kind: 'ciba',
        summary: `${client.name} asks to sign in as you with: ${requested.join(' ')}`,
        actionDigest: digest,
        now,
      },
    );
    return { approvalId: approval.id, expiresAt: approval.expiresAt };
  } catch (error) {
    if (error instanceof ApprovalLimitReached) {
      throw refusedByServer(refusal(client, 'approval_limit'));
    }
    throw error;
  }
}

// For a hint that named nobody: the statements `requestApproval` runs for a
// person, in their order and of their kinds, with nothing stored. The limit is
// counted over requests with the same hint, so a person who does not exist
// reaches it exactly as one who does.
async function decoyApproval(
  tx: TenantScopedDatabase,
  deps: BackchannelDeps,
  client: ClientRecord,
  digestOfHint: string,
  now: Date,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`agent-approvals:${digestOfHint}`}))`,
  );
  const pending = await cibaRequestRepository(tx).unresolvedPendingCount(digestOfHint, now);
  if (pending >= PENDING_APPROVALS_PER_SUBJECT) {
    throw refusedByServer(refusal(client, 'approval_limit'));
  }
  const settings = await readAgentSettings(tx, deps.tenantId);
  await tx.execute(sql`insert into agent_approvals select * from agent_approvals where false`);
  await tx.execute(sql`insert into audit_events select * from audit_events where false`);
  return {
    approvalId: null,
    expiresAt: new Date(now.getTime() + settings.agentApprovalTtlSeconds * 1000),
  };
}
