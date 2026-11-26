import { withTenant } from '@odudu/db';
import { type ConsoleSessionRecord } from '#/repository/console-sessions';
import { tenantNameRepository } from '#/repository/tenants';
import { principalChanged } from '#/service/console-subject';
import { type AdminMethod, type AdminResponse, type Caller } from '#/service/odudu-port';
import {
  forwardedRequestHeaders,
  passedResponseHeaders,
  type PassedHeaders,
} from '#/service/rewrite';
import { freshAccessToken, type FreshTokenDeps } from '#/usecase/fresh-access-token';
import { orUnavailable } from '#/usecase/lock-timeout';
import { endSession, resolveSession, type ResolveSessionDeps } from '#/usecase/resolve-session';

export interface ForwardDeps extends ResolveSessionDeps, FreshTokenDeps {}

export interface ConsoleAdminCall {
  readonly method: AdminMethod;
  /** Already checked to resolve under `/admin/`. */
  readonly path: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body: Buffer | undefined;
  /** The subject the tab believes it is signed in as, from X-Odudu-Console-Subject. */
  readonly believedSubject: string | undefined;
  readonly from: Caller;
  readonly now: Date;
}

export type ForwardResult =
  | {
      readonly kind: 'forwarded';
      readonly status: number;
      readonly headers: PassedHeaders;
      readonly body: Buffer;
    }
  | { readonly kind: 'ended' }
  | { readonly kind: 'principal-changed' }
  | { readonly kind: 'unavailable' };

export interface PreparedCall {
  readonly kind: 'ready';
  readonly session: ConsoleSessionRecord;
  readonly accessToken: string;
}

export type Refusal = Exclude<ForwardResult, { readonly kind: 'forwarded' }>;

// What comes before any admin call: the session the cookie names, the check
// that the tab and the session agree on who is signed in, and a token fresh
// enough to send.
export async function prepareCall(
  deps: ForwardDeps,
  call: ConsoleAdminCall,
): Promise<PreparedCall | Refusal> {
  const cookie = call.headers.cookie;
  const resolved = await resolveSession(
    deps,
    typeof cookie === 'string' ? cookie : undefined,
    call.now,
    call.from,
  );
  if (resolved.kind !== 'ok') return resolved;
  if (principalChanged(call.method, call.believedSubject, resolved.session.subjectId)) {
    return { kind: 'principal-changed' };
  }
  const token = await freshAccessToken(deps, resolved.session, call.now, call.from);
  if (token.kind !== 'ok') return token;
  return { kind: 'ready', session: resolved.session, accessToken: token.accessToken };
}

export function upstreamHeaders(
  call: ConsoleAdminCall,
  accessToken: string,
): Record<string, string> {
  return { ...forwardedRequestHeaders(call.headers), authorization: `Bearer ${accessToken}` };
}

// The admin API also answers 401 for a path naming an unknown tenant or
// one the token was not issued by, so a 401 ends the session only once the
// token is refused at its own tenant too. Nothing is refreshed on it: that
// would present a refresh token the lock no longer guards.
export async function endIfRefused(
  deps: ForwardDeps,
  prepared: PreparedCall,
  status: number,
  from: Caller,
): Promise<Refusal | null> {
  if (
    status !== 401 ||
    !(await refusedAtHome(deps, prepared.session, prepared.accessToken, from))
  ) {
    return null;
  }
  return orUnavailable(async () => {
    await endSession(deps, prepared.session, from);
    return { kind: 'ended' } as const;
  });
}

export async function forwardAdminCall(
  deps: ForwardDeps,
  call: ConsoleAdminCall,
): Promise<ForwardResult> {
  const prepared = await prepareCall(deps, call);
  if (prepared.kind !== 'ready') return prepared;

  const response: AdminResponse = await deps.odudu.forward({
    method: call.method,
    path: call.path,
    headers: upstreamHeaders(call, prepared.accessToken),
    body: call.body,
    from: call.from,
  });
  const ended = await endIfRefused(deps, prepared, response.status, call.from);
  if (ended !== null) return ended;
  return {
    kind: 'forwarded',
    status: response.status,
    headers: passedResponseHeaders(response.headers),
    body: response.body,
  };
}

async function refusedAtHome(
  deps: ForwardDeps,
  session: ConsoleSessionRecord,
  accessToken: string,
  from: Caller,
): Promise<boolean> {
  const tenant = await withTenant(deps.database.db, session.tenantId, (tx) =>
    tenantNameRepository(tx).nameOf(session.tenantId),
  );
  if (tenant === null) return true;
  const whoami = await deps.odudu.forward({
    method: 'GET',
    path: `/admin/tenants/${encodeURIComponent(tenant)}/whoami`,
    headers: { authorization: `Bearer ${accessToken}` },
    body: undefined,
    from,
  });
  return whoami.status === 401;
}
