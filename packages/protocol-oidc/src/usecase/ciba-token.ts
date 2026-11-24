import { signJwt, signingKeyRepository, type SigningKeyRecord } from '@odudu/crypto';
import { withTenant, type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { agentApprovalRepository } from '@odudu/domain-agents';
import { auditRepository, type RequestContext } from '@odudu/domain-audit';
import { subjectIsEnabled, subjectRepository } from '@odudu/domain-identity';
import { clientScopeRepository, type ClientRecord } from '@odudu/domain-tenant';
import { type ClaimMapperRegistry, type Clock, newId } from '@odudu/kernel';
import { cibaRequestRepository, type CibaRequestRecord } from '#/repository/ciba-requests';
import { type ClientOidcConfig } from '#/repository/client-oidc-config';
import { tokenGrantRepository } from '#/repository/grants';
import { reachableRoleIds } from '#/repository/scope-role-reach';
import { type ClaimContext } from '#/service/claims';
import {
  accessDenied,
  authorizationPending,
  expiredToken,
  invalidGrant,
  invalidScope,
  slowDown,
  type TokenError,
  type TokenRefusalAudit,
} from '#/service/errors';
import { CIBA_GRANT, hashAuthReqId } from '#/service/ciba';
import { idTokenScopeOf, mappedClaims } from '#/service/issued-claims';
import { resolveScope } from '#/service/scope';
import { withRegisteredClaimsWinning } from '#/service/token-claims';
import { consumeApproval } from '#/usecase/approvals';
import { cibaActionDigest } from '#/usecase/ciba';
import { loadClaimContextIn } from '#/usecase/evaluate-claims';

export interface CibaPollRequest {
  readonly grantType: typeof CIBA_GRANT;
  readonly authReqId: string;
}

export interface CibaTokenDeps {
  readonly tenantId: string;
  // A poll's bookkeeping commits on a transaction of its own: the poll that
  // records it is, most of the time, one that answers with an error.
  readonly database: DatabaseHandle;
  readonly issuer: string;
  readonly kek: Uint8Array;
  readonly clock: Clock;
  readonly claimMappers: ClaimMapperRegistry<ClaimContext>;
  readonly request: RequestContext;
}

export type CibaIssuingConfig = Pick<ClientOidcConfig, 'idTokenSignedResponseAlg'> & {
  readonly accessTokenTtlSeconds: number;
  readonly idTokenTtlSeconds: number;
};

// What minting needs from token issuance, handed in so this file stays
// beneath it in the import graph.
export interface CibaMinting {
  accessToken(
    input: {
      subjectId: string;
      clientId: string;
      scope: string[];
      config: Pick<CibaIssuingConfig, 'accessTokenTtlSeconds'>;
      audience: readonly string[];
      fullScopeAllowed: boolean;
      sessionId: null;
      grantId: string;
    },
    now: Date,
  ): Promise<{ accessToken: string; iat: number; exp: number; audience: string[] }>;
  idTokenKey(active: SigningKeyRecord): Promise<SigningKeyRecord>;
}

export interface CibaTokenResponse {
  access_token: string;
  id_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
}

function refused(
  client: ClientRecord,
  row: CibaRequestRecord,
  reason: TokenRefusalAudit['reason'],
): TokenRefusalAudit {
  return {
    action: 'ciba.poll_refused',
    reason,
    clientDbId: client.id,
    ...(row.subjectId === null ? {} : { subjectId: row.subjectId }),
    ...(row.approvalId === null ? {} : { approvalId: row.approvalId }),
  };
}

// OpenID CIBA §10.1 and §11, poll mode. A request for nobody reads here as
// one nobody has decided: pending until it expires.
export async function issueCibaTokens(
  tx: TenantScopedDatabase,
  deps: CibaTokenDeps,
  request: CibaPollRequest,
  client: ClientRecord,
  config: CibaIssuingConfig,
  minting: CibaMinting,
): Promise<CibaTokenResponse> {
  const row = await cibaRequestRepository(tx).byHash(hashAuthReqId(request.authReqId));
  if (row === null) throw invalidGrant();
  if (row.clientId !== client.id) throw invalidGrant();

  const now = deps.clock.now();
  if (row.expiresAt <= now) throw expiredToken(refused(client, row, 'expired'));

  const poll = await withTenant(
    deps.database.db,
    deps.tenantId,
    (own) => cibaRequestRepository(own).recordPoll(row.id, now),
    deps.request,
  );
  if (poll === 'early') throw slowDown(refused(client, row, 'polled_early'));

  const decision = await decisionOf(tx, row, client, now);
  if (decision instanceof Error) throw decision;
  return redeem(tx, deps, client, config, minting, row, decision, now);
}

interface Approved {
  readonly approvalId: string;
  readonly subjectId: string;
  readonly decidedAt: Date;
}

async function decisionOf(
  tx: TenantScopedDatabase,
  row: CibaRequestRecord,
  client: ClientRecord,
  now: Date,
): Promise<Approved | TokenError> {
  if (row.subjectId === null || row.approvalId === null) return authorizationPending();
  const approval = await agentApprovalRepository(tx).byId(row.approvalId);
  if (approval === null || approval.state === 'consumed') return invalidGrant();
  switch (approval.state) {
    case 'pending':
      return approval.expiresAt <= now
        ? expiredToken(refused(client, row, 'expired'))
        : authorizationPending();
    case 'denied':
      return accessDenied(refused(client, row, 'denied'));
    case 'expired':
      return expiredToken(refused(client, row, 'expired'));
    default:
      return approval.decidedAt === null || approval.expiresAt <= now
        ? expiredToken(refused(client, row, 'expired'))
        : { approvalId: approval.id, subjectId: row.subjectId, decidedAt: approval.decidedAt };
  }
}

async function redeem(
  tx: TenantScopedDatabase,
  deps: CibaTokenDeps,
  client: ClientRecord,
  config: CibaIssuingConfig,
  minting: CibaMinting,
  row: CibaRequestRecord,
  approved: Approved,
  now: Date,
): Promise<CibaTokenResponse> {
  // The person approved a request; they may have been disabled since.
  if (!subjectIsEnabled(await subjectRepository(tx).byId(approved.subjectId))) {
    throw invalidGrant();
  }
  const assigned = await clientScopeRepository(tx).forClient(client.id);
  const scope = resolveScope(
    row.scope,
    assigned.map((clientScope) => clientScope.name),
    null,
    null,
  );
  if (!scope.includes('openid')) throw invalidScope();

  const digest = cibaActionDigest(deps.tenantId, approved.subjectId, client, {
    scope: row.scope,
    bindingMessage: row.bindingMessage,
    requestedExpiry: row.requestedExpiry,
  });
  if (!(await consumeApproval(tx, approved.approvalId, digest, now))) throw invalidGrant();

  const grantId = newId();
  const { accessToken, audience, iat, exp } = await minting.accessToken(
    {
      subjectId: approved.subjectId,
      clientId: client.clientId,
      scope,
      config,
      audience: [],
      fullScopeAllowed: client.fullScopeAllowed,
      sessionId: null,
      grantId,
    },
    now,
  );

  const claimContext = await loadClaimContextIn(tx, deps.tenantId, approved.subjectId);
  const reachable = await reachableRoleIds(tx, scope);
  const assembled = await mappedClaims(
    deps.claimMappers,
    idTokenScopeOf(assigned, scope),
    claimContext,
    { reachableRoleIds: reachable, fullScopeAllowed: client.fullScopeAllowed },
  );
  const idToken = await signJwt(
    withRegisteredClaimsWinning(assembled, {
      iss: deps.issuer,
      sub: approved.subjectId,
      aud: client.clientId,
      iat,
      exp: iat + config.idTokenTtlSeconds,
      auth_time: Math.floor(approved.decidedAt.getTime() / 1000),
    }),
    {
      key: await minting.idTokenKey(await signingKeyRepository(tx).active()),
      kek: deps.kek,
    },
  );

  await tokenGrantRepository(tx).create({
    id: grantId,
    tenantId: deps.tenantId,
    clientId: client.id,
    subjectId: approved.subjectId,
    scope: scope.join(' '),
    audience,
    sessionId: null,
  });
  const repository = auditRepository(tx);
  await repository.record({
    eventType: 'token',
    action: 'token.issue',
    outcome: 'allowed',
    actorSubjectId: approved.subjectId,
    actorClientId: client.id,
    resourceType: 'grant',
    resourceId: grantId,
    detail: { grant_type: CIBA_GRANT, scope: scope.join(' ') },
  });
  await repository.record({
    eventType: 'agent_identity',
    action: 'ciba.token_issued',
    outcome: 'allowed',
    actorSubjectId: approved.subjectId,
    actorClientId: client.id,
    resourceType: 'agent_approval',
    resourceId: approved.approvalId,
    detail: { agent_client: client.id, owner: approved.subjectId, approval: approved.approvalId },
  });

  return {
    access_token: accessToken,
    id_token: idToken,
    token_type: 'Bearer',
    expires_in: exp - iat,
    scope: scope.join(' '),
  };
}
