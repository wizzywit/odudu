import { isSystemTenantName } from '@odudu/domain-tenant';
import { type Caller } from '#/service/odudu-port';
import {
  describeSession,
  resolveSession,
  type ResolveSessionDeps,
} from '#/usecase/resolve-session';

export type TenantReadDeps = ResolveSessionDeps;

// `ok`, `ended` and `unavailable` mirror `ResolvedSession`; `forbidden` is
// a live session whose own tenant is neither the one named nor `system`.
export type TenantReadOutcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'ended' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'forbidden' };

// A system administrator's own tenant reads any tenant's public documents;
// anyone else reads only the one their session belongs to.
export async function authorizeTenantRead(
  deps: TenantReadDeps,
  tenant: string,
  cookieHeader: string | undefined,
  now: Date,
  from: Caller,
): Promise<TenantReadOutcome> {
  const resolved = await resolveSession(deps, cookieHeader, now, from);
  if (resolved.kind !== 'ok') return resolved;
  const summary = await describeSession(deps, resolved.session);
  if (summary === null) return { kind: 'ended' };
  if (summary.tenant === tenant || isSystemTenantName(summary.tenant)) return { kind: 'ok' };
  return { kind: 'forbidden' };
}
