import { withTenant } from '@odudu/db';
import { consoleSessionRepository, type ConsoleSessionRecord } from '#/repository/console-sessions';
import { type AdminMethod, type AdminResponse } from '#/service/odudu-port';
import {
  forwardedRequestHeaders,
  passedResponseHeaders,
  type PassedHeaders,
} from '#/service/rewrite';
import { freshAccessToken, type FreshTokenDeps } from '#/usecase/fresh-access-token';
import { orUnavailable } from '#/usecase/lock-timeout';
import { resolveSession, type ResolveSessionDeps } from '#/usecase/resolve-session';

export interface ForwardDeps extends ResolveSessionDeps, FreshTokenDeps {}

export interface ConsoleAdminCall {
  readonly method: AdminMethod;
  /** Already checked to resolve under `/admin/`. */
  readonly path: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body: Buffer | undefined;
  readonly ip: string;
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
  | { readonly kind: 'unavailable' };

// The admin API's own 401 ends the session, and nothing is presented:
// refreshing and retrying on it would present a refresh token the lock no
// longer guards, and a grant it refuses is one already ended.
export async function forwardAdminCall(
  deps: ForwardDeps,
  call: ConsoleAdminCall,
): Promise<ForwardResult> {
  const cookie = call.headers.cookie;
  const resolved = await resolveSession(
    deps,
    typeof cookie === 'string' ? cookie : undefined,
    call.now,
    call.ip,
  );
  if (resolved.kind !== 'ok') return resolved;
  const token = await freshAccessToken(deps, resolved.session, call.now, call.ip);
  if (token.kind !== 'ok') return token;

  const response: AdminResponse = await deps.odudu.forward({
    method: call.method,
    path: call.path,
    headers: {
      ...forwardedRequestHeaders(call.headers),
      authorization: `Bearer ${token.accessToken}`,
    },
    body: call.body,
    ip: call.ip,
  });
  if (response.status === 401) return dropSession(deps, resolved.session);
  return {
    kind: 'forwarded',
    status: response.status,
    headers: passedResponseHeaders(response.headers),
    body: response.body,
  };
}

async function dropSession(
  deps: ForwardDeps,
  session: ConsoleSessionRecord,
): Promise<ForwardResult> {
  return orUnavailable(async () => {
    await withTenant(deps.database.db, session.tenantId, (tx) =>
      consoleSessionRepository(tx).take(session.id),
    );
    return { kind: 'ended' } as const;
  });
}
