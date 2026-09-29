import { isSystemTenantName } from '@odudu/domain-tenant';
import { type Caller, type DiscoveryDocument, type JsonWebKeySet } from '#/service/odudu-port';
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

// What reading one tenant's public document answers, past authorization:
// `not-found` is the public route's own 404, reached only once the reader
// is entitled to ask (own tenant, or `system`), so it never tells a
// refused reader whether the tenant they asked for exists.
export type TenantDocumentOutcome<T> =
  | { readonly kind: 'ok'; readonly document: T }
  | { readonly kind: 'ended' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not-found' };

async function readTenantDocument<T>(
  deps: TenantReadDeps,
  tenant: string,
  cookieHeader: string | undefined,
  now: Date,
  from: Caller,
  fetch: (tenant: string, from: Caller) => Promise<T | null>,
): Promise<TenantDocumentOutcome<T>> {
  const authorized = await authorizeTenantRead(deps, tenant, cookieHeader, now, from);
  if (authorized.kind !== 'ok') return authorized;
  const document = await fetch(tenant, from);
  return document === null ? { kind: 'not-found' } : { kind: 'ok', document };
}

export function readTenantDiscovery(
  deps: TenantReadDeps,
  tenant: string,
  cookieHeader: string | undefined,
  now: Date,
  from: Caller,
): Promise<TenantDocumentOutcome<DiscoveryDocument>> {
  return readTenantDocument(deps, tenant, cookieHeader, now, from, (t, f) =>
    deps.odudu.discoveryOf(t, f),
  );
}

export function readTenantKeys(
  deps: TenantReadDeps,
  tenant: string,
  cookieHeader: string | undefined,
  now: Date,
  from: Caller,
): Promise<TenantDocumentOutcome<JsonWebKeySet>> {
  return readTenantDocument(deps, tenant, cookieHeader, now, from, (t, f) =>
    deps.odudu.keysOf(t, f),
  );
}
