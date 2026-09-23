import { sessionRepository, type SessionLifespans } from '@odudu/authn-flows';
import { AUDIENCE_UNCHECKED, signingKeyRepository, verifyJwt } from '@odudu/crypto';
import { type TenantScopedDatabase } from '@odudu/db';
import { type JWTPayload } from 'jose';
import { tokenGrantRepository } from '#/repository/grants';
import { type ExchangeTokenType } from '#/service/token-exchange';

export interface ResolvedExchangeToken {
  subjectId: string;
  scope: readonly string[];
  sessionId: string | null;
  grantId: string | null;
  act: unknown;
  mayAct: unknown;
  expiresAt: Date | null;
}

// RFC 8693 §2.2.2 makes every failure of this resolution `invalid_request`,
// with no further detail — the same discipline `invalidGrant()` already
// enforces at the authorization_code path — so `refused` carries no reason
// a caller could use to tell an unknown token from a dead grant.
export type ResolveOutcome = { kind: 'ok'; token: ResolvedExchangeToken } | { kind: 'refused' };

export interface ResolveDeps {
  issuer: string;
  requestingClientId: string;
  lifespans: SessionLifespans;
  now: Date;
}

// Checked, never touched: rotation extends the idle window because a user
// is present; an exchange is a third party acting on a delegated token, and
// letting it extend the window would keep a departed user signed in for as
// long as anything downstream stayed busy.
async function sessionIsLive(
  tx: TenantScopedDatabase,
  deps: ResolveDeps,
  sessionId: string,
): Promise<boolean> {
  return (await sessionRepository(tx).liveById(sessionId, deps.lifespans, deps.now)) !== null;
}

async function resolveAccessToken(
  tx: TenantScopedDatabase,
  deps: ResolveDeps,
  token: string,
): Promise<ResolveOutcome> {
  let payload: JWTPayload;
  try {
    payload = await verifyJwt(token, {
      keys: await signingKeyRepository(tx).listPublishable(),
      issuer: deps.issuer,
      audience: AUDIENCE_UNCHECKED,
      typ: 'at+jwt',
    });
  } catch {
    return { kind: 'refused' };
  }

  const grantId = typeof payload.grant_id === 'string' ? payload.grant_id : null;
  if (grantId === null) return { kind: 'refused' };
  const grant = await tokenGrantRepository(tx).byId(grantId);
  if (grant?.revokedAt !== null) return { kind: 'refused' };
  if (grant.sessionId !== null && !(await sessionIsLive(tx, deps, grant.sessionId))) {
    return { kind: 'refused' };
  }

  return {
    kind: 'ok',
    token: {
      subjectId: grant.subjectId,
      scope: grant.scope.split(' ').filter((entry) => entry !== ''),
      sessionId: grant.sessionId,
      grantId: grant.id,
      act: payload.act,
      mayAct: payload.may_act,
      expiresAt: typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : null,
    },
  };
}

export async function resolveExchangeToken(
  tx: TenantScopedDatabase,
  deps: ResolveDeps,
  type: ExchangeTokenType,
  token: string,
): Promise<ResolveOutcome> {
  switch (type) {
    case 'access_token':
      return resolveAccessToken(tx, deps, token);
    case 'refresh_token':
    case 'id_token':
      throw new Error(`${type} exchange is not resolved yet`);
  }
}
