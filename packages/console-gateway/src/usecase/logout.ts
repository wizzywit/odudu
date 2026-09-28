import { unwrapSecret } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { ADMIN_CLIENT_ID, CONSOLE_POST_LOGOUT_PATH } from '@odudu/domain-tenant';
import { consoleSessionRepository } from '#/repository/console-sessions';
import { tenantNameRepository } from '#/repository/tenants';
import { endGrant } from '#/usecase/end-grant';
import { resolveSession, type ResolveSessionDeps } from '#/usecase/resolve-session';

export interface LogoutDeps extends ResolveSessionDeps {
  readonly base: URL;
}

export interface Logout {
  readonly cookieHeader: string | undefined;
  readonly ip: string;
  readonly now: Date;
}

/** Where the browser goes next: the tenant's logout, or the console when there is none to end. */
export interface LoggedOut {
  readonly redirect: string;
}

const TO_CONSOLE: LoggedOut = { redirect: CONSOLE_POST_LOGOUT_PATH };

// The gateway's session ends here whatever the server answers. The SSO
// session can only be ended by the browser itself, since only its own
// navigation to the tenant's logout endpoint carries the tenant's cookie.
export async function logout(deps: LogoutDeps, input: Logout): Promise<LoggedOut> {
  const resolved = await resolveSession(deps, input.cookieHeader, input.now, input.ip);
  if (resolved.kind === 'ended') return TO_CONSOLE;
  const { tenantId, id } = resolved.session;
  const taken = await withTenant(deps.database.db, tenantId, async (tx) => {
    const session = await consoleSessionRepository(tx).take(id);
    if (session === null) return null;
    const tenant = await tenantNameRepository(tx).nameOf(tenantId);
    return tenant === null ? null : { session, tenant };
  });
  if (taken === null) return TO_CONSOLE;

  const { session, tenant } = taken;
  await endGrant(deps.odudu, tenant, unwrapSecret(session.refreshTokenWrapped, deps.kek), input.ip);
  const issuer = await deps.odudu.issuerOf(tenant, input.ip);
  if (issuer === null) return TO_CONSOLE;

  // OIDC RP-Initiated Logout 1.0 §2; the hint lets the server end the
  // session without asking the End-User to confirm.
  const target = new URL(`${issuer}/protocol/openid-connect/logout`);
  target.search = new URLSearchParams({
    id_token_hint: unwrapSecret(session.idTokenWrapped, deps.kek),
    post_logout_redirect_uri: new URL(CONSOLE_POST_LOGOUT_PATH, deps.base).toString(),
    client_id: ADMIN_CLIENT_ID,
  }).toString();
  return { redirect: target.toString() };
}
