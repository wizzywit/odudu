import { sessionRepository } from '@odudu/authn-flows';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { type TenantScopedDatabase } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { newId } from '@odudu/kernel';
import { tokenGrantRepository, type ClientLogoutTarget } from '#/repository/grants';
import { logoutDeliveryRepository } from '#/repository/logout-deliveries';
import { logoutTokenClaims, LOGOUT_TOKEN_TYP } from '#/service/logout-token';

function hasBackchannelLogoutUri<Target extends ClientLogoutTarget>(
  target: Target,
): target is Target & { backchannelLogoutUri: string } {
  return target.backchannelLogoutUri !== null;
}

export interface EndSessionDeps {
  readonly kek: Uint8Array;
}

export interface EndSessionInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly subjectId: string;
  readonly now: Date;
  readonly issuer: string;
  readonly via: 'logout' | 'admin' | 'self';
}

// The one path that ends a session — the RP-Initiated Logout flow
// (`#/usecase/logout.ts`) and the admin API's session-ending route both
// call this rather than each carrying its own copy. One transaction, per
// Back-Channel Logout §2.7: end the session, revoke every grant it holds,
// then enqueue a delivery per client that used it and registered a
// back-channel URI. A failure anywhere rolls it all back, so nothing
// retries a delivery row that was never written.
export async function endSession(
  tx: TenantScopedDatabase,
  deps: EndSessionDeps,
  input: EndSessionInput,
): Promise<void> {
  await endSessions(tx, deps, {
    tenantId: input.tenantId,
    sessionIds: [input.sessionId],
    subjectId: input.subjectId,
    now: input.now,
    issuer: input.issuer,
    via: input.via,
  });
}

export interface EndSessionsInput {
  readonly tenantId: string;
  readonly sessionIds: readonly string[];
  readonly subjectId: string;
  readonly now: Date;
  readonly issuer: string;
  readonly via: 'logout' | 'admin' | 'self';
}

// `endSession` for several sessions of one subject, in a fixed number of
// statements however many there are.
export async function endSessions(
  tx: TenantScopedDatabase,
  deps: EndSessionDeps,
  input: EndSessionsInput,
): Promise<void> {
  const ended = await sessionRepository(tx).endAll(input.sessionIds, input.now);
  await auditRepository(tx).recordAll(
    ended.map((sessionId) => ({
      eventType: 'session' as const,
      action: 'session.ended' as const,
      outcome: 'allowed' as const,
      actorSubjectId: input.subjectId,
      resourceType: 'session',
      resourceId: sessionId,
      detail: { via: input.via },
    })),
  );
  await tokenGrantRepository(tx).revokeForSessions(input.sessionIds, input.now);

  const targets = await tokenGrantRepository(tx).clientsForSessions(input.sessionIds);
  const backchannelTargets = targets.filter(hasBackchannelLogoutUri);
  if (backchannelTargets.length === 0) return;

  const key = await signingKeyRepository(tx).active();
  const deliveries = await Promise.all(
    backchannelTargets.map(async (target) => {
      const claims = logoutTokenClaims({
        issuer: input.issuer,
        audience: target.oauthClientId,
        subject: input.subjectId,
        sessionId: target.sessionId,
        now: input.now,
      });
      const logoutToken = await signJwt(
        { ...claims },
        { key, kek: deps.kek, typ: LOGOUT_TOKEN_TYP },
      );
      return {
        id: newId(),
        tenantId: input.tenantId,
        clientId: target.clientId,
        sessionId: target.sessionId,
        endpoint: target.backchannelLogoutUri,
        logoutToken,
        nextAttemptAt: input.now,
      };
    }),
  );
  await logoutDeliveryRepository(tx).enqueue(deliveries);
}

export interface EndAllAccessInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly now: Date;
  readonly issuer: string;
}

// Sessions ended per batch: bounds the tokens signed and rows written by one
// statement set, so a subject with a great many sessions takes more rounds,
// not larger ones.
const SESSIONS_PER_BATCH = 100;

// What recovering an account owes whoever else is signed in to it: every session
// of the subject ended the way a logout ends one (grants revoked, back-channel
// deliveries queued), then every grant left, offline ones included, revoked.
// One transaction with the password change that asks for it.
export async function endAllAccess(
  tx: TenantScopedDatabase,
  deps: EndSessionDeps,
  input: EndAllAccessInput,
): Promise<void> {
  for (;;) {
    const batch = await sessionRepository(tx).liveIdsFor(
      input.subjectId,
      input.now,
      SESSIONS_PER_BATCH,
    );
    if (batch.length === 0) break;
    await endSessions(tx, deps, {
      tenantId: input.tenantId,
      sessionIds: batch,
      subjectId: input.subjectId,
      now: input.now,
      issuer: input.issuer,
      via: 'logout',
    });
  }
  await tokenGrantRepository(tx).revokeForSubject(input.subjectId, input.now);
}
