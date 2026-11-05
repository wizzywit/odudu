import { ACCESS_TOKEN_CEILING_SECONDS } from '@odudu/contracts/admin';
import { addressIssuer, domainAddress, pathAddress } from '@odudu/kernel';
import { CanonicalConflictError, type DomainRow } from '#/repository/tenant-domains';
import { type DomainState } from '#/schema/tenant-domains';

export interface SwitchDomains {
  canonical(tenantId: string): Promise<DomainRow | null>;
  lock(tenantId: string): Promise<void>;
  get(tenantId: string, id: string): Promise<DomainRow | null>;
  setCanonical(tenantId: string, id: string): Promise<DomainRow | null>;
  clearCanonical(tenantId: string): Promise<number>;
  retireIssuer(tenantId: string, issuer: string, expiresAt: Date): Promise<void>;
  clearRetirement(tenantId: string, issuer: string): Promise<boolean>;
}

export interface SwitchCanonicalDeps {
  domains: SwitchDomains;
  // `ODUDU_PUBLIC_BASE_URL`, and whether domains are served over https: the
  // issuer strings a switch retires are the ones tokens carry.
  base: string | undefined;
  tls: boolean;
}

// `path`, or the id of a domain row.
export type SwitchTarget = string;

export type SwitchOutcome =
  | { kind: 'switched'; canonical: DomainRow | null; previous: DomainRow | null }
  | { kind: 'unchanged'; canonical: DomainRow | null }
  | { kind: 'not_found' }
  | { kind: 'not_verified'; state: DomainState }
  | { kind: 'no_base_url' }
  | { kind: 'conflict' }
  | { kind: 'precondition_failed' };

export interface SwitchOptions {
  // Judged against the canonical row read once the tenant's lock is held, so
  // a precondition cannot pass on a state another switch has since changed.
  precondition?: (current: DomainRow | null) => boolean;
}

// The one place a tenant's canonical address changes: an admin's switch and
// the fall-back from a domain that stopped proving itself both run it.
// A switch that another one overtook between this call's first read and the
// lock answers `conflict` rather than applying on top of it.
export async function switchCanonical(
  deps: SwitchCanonicalDeps,
  tenant: { id: string; name: string },
  target: SwitchTarget,
  now: Date,
  options: SwitchOptions = {},
): Promise<SwitchOutcome> {
  const { domains, base } = deps;
  if (base === undefined) return { kind: 'no_base_url' };
  const seen = await domains.canonical(tenant.id);
  await domains.lock(tenant.id);
  const current = await domains.canonical(tenant.id);
  if ((seen?.id ?? null) !== (current?.id ?? null)) return { kind: 'conflict' };
  if (options.precondition?.(current) === false) return { kind: 'precondition_failed' };

  let next: DomainRow | null = null;
  if (target !== 'path') {
    next = await domains.get(tenant.id, target);
    if (next === null) return { kind: 'not_found' };
    if (next.state !== 'verified') return { kind: 'not_verified', state: next.state };
  }
  if ((current?.id ?? null) === (next?.id ?? null))
    return { kind: 'unchanged', canonical: current };

  const issuerOf = (row: DomainRow | null): string =>
    addressIssuer(
      row === null ? pathAddress(base, tenant.name) : domainAddress(row.host, deps.tls),
    );
  let canonical: DomainRow | null = null;
  try {
    if (next === null) await domains.clearCanonical(tenant.id);
    else {
      canonical = await domains.setCanonical(tenant.id, next.id);
      if (canonical === null) return { kind: 'not_found' };
    }
  } catch (error) {
    if (error instanceof CanonicalConflictError) return { kind: 'conflict' };
    throw error;
  }
  const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_CEILING_SECONDS * 1000);
  await domains.retireIssuer(tenant.id, issuerOf(current), expiresAt);
  await domains.clearRetirement(tenant.id, issuerOf(next));
  return { kind: 'switched', canonical, previous: current };
}
