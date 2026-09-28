import { withTenant, type DatabaseHandle } from '@odudu/db';
import { userRepository } from '@odudu/domain-identity';
import { consoleSessionRepository, type ConsoleSessionRecord } from '#/repository/console-sessions';
import { tenantNameRepository } from '#/repository/tenants';
import { readCookie, sessionCookieName } from '#/service/cookies';
import { sha256, splitTenantBound } from '#/service/secrets';
import { sessionHasEnded, sessionNeedsTouch } from '#/service/session-lifetime';

export interface ResolveSessionDeps {
  readonly database: DatabaseHandle;
  readonly tls: boolean;
}

export type ResolvedSession =
  { readonly kind: 'ok'; readonly session: ConsoleSessionRecord } | { readonly kind: 'ended' };

const ENDED: ResolvedSession = { kind: 'ended' };

// The cookie's tenant half sets the context the row is read under, so a
// prefix edited to another tenant finds nothing rather than a foreign row.
export async function resolveSession(
  deps: ResolveSessionDeps,
  cookieHeader: string | undefined,
  now: Date,
): Promise<ResolvedSession> {
  const value = readCookie(cookieHeader, sessionCookieName(deps.tls));
  const bound = value === undefined ? null : splitTenantBound(value);
  if (bound === null) return ENDED;
  return withTenant(deps.database.db, bound.tenantId, async (tx) => {
    const sessions = consoleSessionRepository(tx);
    const session = await sessions.bySecretHash(sha256(bound.secret));
    if (session === null) return ENDED;
    if (sessionHasEnded(session, now)) {
      await sessions.delete(session.id);
      return ENDED;
    }
    if (!sessionNeedsTouch(session, now)) return { kind: 'ok', session };
    if (!(await sessions.touch(session.id, now))) return ENDED;
    return { kind: 'ok', session: { ...session, lastSeenAt: now } };
  });
}

export interface SessionSummary {
  readonly tenant: string;
  readonly subjectId: string;
  /** Null for a subject with no user record, which cannot sign in interactively. */
  readonly username: string | null;
}

export async function describeSession(
  deps: ResolveSessionDeps,
  session: ConsoleSessionRecord,
): Promise<SessionSummary | null> {
  return withTenant(deps.database.db, session.tenantId, async (tx) => {
    const tenant = await tenantNameRepository(tx).nameOf(session.tenantId);
    if (tenant === null) return null;
    const user = await userRepository(tx).bySubjectId(session.subjectId);
    return { tenant, subjectId: session.subjectId, username: user?.username ?? null };
  });
}
