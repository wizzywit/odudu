import { unwrapSecret } from '@odudu/crypto';
import { type TenantScopedDatabase, withTenant, type DatabaseHandle } from '@odudu/db';
import { userRepository } from '@odudu/domain-identity';
import { consoleSessionRepository, type ConsoleSessionRecord } from '#/repository/console-sessions';
import { tenantNameRepository } from '#/repository/tenants';
import { readCookie, sessionCookieName } from '#/service/cookies';
import { type Caller, type OduduPort } from '#/service/odudu-port';
import { sha256, splitTenantBound } from '#/service/secrets';
import { sessionHasEnded, sessionNeedsTouch } from '#/service/session-lifetime';
import { endGrant } from '#/usecase/end-grant';
import { orUnavailable } from '#/usecase/lock-timeout';

export interface ResolveSessionDeps {
  readonly database: DatabaseHandle;
  readonly kek: Uint8Array;
  readonly odudu: OduduPort;
  readonly tls: boolean;
}

// `unavailable`: the session is over, but a refresh held its row past the
// lock timeout, so the row and its grant are left for the next request.
export type ResolvedSession =
  | { readonly kind: 'ok'; readonly session: ConsoleSessionRecord }
  | { readonly kind: 'ended' }
  | { readonly kind: 'unavailable' };

const ENDED: ResolvedSession = { kind: 'ended' };

interface Taken {
  readonly kind: 'taken';
  readonly tenant: string;
  readonly refreshToken: string;
}

function boundCookie(
  deps: ResolveSessionDeps,
  cookieHeader: string | undefined,
): ReturnType<typeof splitTenantBound> {
  const value = readCookie(cookieHeader, sessionCookieName(deps.tls));
  return value === undefined ? null : splitTenantBound(value);
}

// Deleting the row destroys the only copy of the refresh token, so the
// grant behind it is revoked once the transaction has let the row go.
async function takeRow(
  tx: TenantScopedDatabase,
  deps: ResolveSessionDeps,
  session: ConsoleSessionRecord,
): Promise<Taken | null> {
  const taken = await consoleSessionRepository(tx).take(session.id);
  if (taken === null) return null;
  const tenant = await tenantNameRepository(tx).nameOf(session.tenantId);
  if (tenant === null) return null;
  return { kind: 'taken', tenant, refreshToken: unwrapSecret(taken.refreshTokenWrapped, deps.kek) };
}

// The cookie's tenant half sets the context the row is read under, so a
// prefix edited to another tenant finds nothing rather than a foreign row.
export async function resolveSession(
  deps: ResolveSessionDeps,
  cookieHeader: string | undefined,
  now: Date,
  from: Caller,
): Promise<ResolvedSession> {
  const bound = boundCookie(deps, cookieHeader);
  if (bound === null) return ENDED;
  const found = await orUnavailable(() =>
    withTenant(
      deps.database.db,
      bound.tenantId,
      async (tx): Promise<ResolvedSession | Taken | null> => {
        const sessions = consoleSessionRepository(tx);
        const session = await sessions.bySecretHash(sha256(bound.secret));
        if (session === null) return ENDED;
        if (sessionHasEnded(session, now)) return takeRow(tx, deps, session);
        if (!sessionNeedsTouch(session, now)) return { kind: 'ok', session };
        if ((await sessions.touch(session.id, now)) === 'gone') return ENDED;
        return { kind: 'ok', session: { ...session, lastSeenAt: now } };
      },
    ),
  );
  if (found === null) return ENDED;
  if (found.kind !== 'taken') return found;
  await endGrant(deps.odudu, found.tenant, found.refreshToken, from);
  return ENDED;
}

/** Ends whatever live session the cookie names, as a sign-in replacing it does. */
export async function endNamedSession(
  deps: ResolveSessionDeps,
  cookieHeader: string | undefined,
  from: Caller,
): Promise<void> {
  const bound = boundCookie(deps, cookieHeader);
  if (bound === null) return;
  const taken = await withTenant(deps.database.db, bound.tenantId, async (tx) => {
    const session = await consoleSessionRepository(tx).bySecretHash(sha256(bound.secret));
    return session === null ? null : takeRow(tx, deps, session);
  });
  if (taken !== null) await endGrant(deps.odudu, taken.tenant, taken.refreshToken, from);
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
