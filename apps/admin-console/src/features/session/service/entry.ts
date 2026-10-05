import { SYSTEM_TENANT, type Principal } from '#/shared/service/principal.ts';

// A tenant administrator opening another tenant's console is asked first:
// signing in there replaces this session. A system administrator enters.
export function signedInElsewhere(principal: Principal | null, tenant: string): boolean {
  return principal !== null && principal.tenant !== tenant && principal.tenant !== SYSTEM_TENANT;
}

export function isSystemPrincipal(principal: Principal | null): boolean {
  return principal?.tenant === SYSTEM_TENANT;
}

// A tenant administrator's session is the one a sign-in elsewhere replaces.
export function replacedSession(principal: Principal | null): Principal | null {
  return principal !== null && !isSystemPrincipal(principal) ? principal : null;
}

// A system administrator enters a tenant rather than signing in to it.
export function entersDirectly(principal: Principal | null, tenant: string): boolean {
  return principal !== null && (isSystemPrincipal(principal) || principal.tenant === tenant);
}

export type HomeTarget =
  | { kind: 'elsewhere'; principal: Principal; tenant: string }
  | { kind: 'leaving'; tenant: string }
  | { kind: 'choose' };

// A signed-in administrator goes on to their tenant; a tenant named by
// ?tenant= goes straight to its sign-in, unless it would replace another
// tenant's session; otherwise the question is asked, and ?choose asks it of
// a signed-in administrator too.
export function homeTarget({
  principal,
  named,
  choosing,
}: {
  principal: Principal | null;
  named: string | null;
  choosing: boolean;
}): HomeTarget {
  if (named !== null && principal !== null && signedInElsewhere(principal, named)) {
    return { kind: 'elsewhere', principal, tenant: named };
  }
  const tenant = named ?? (principal !== null && !choosing ? principal.tenant : null);
  return tenant === null ? { kind: 'choose' } : { kind: 'leaving', tenant };
}

// A session that ended signs in again where it was issued, which for a
// system administrator is `system`.
export function signInHome(ended: Principal | null, tenant: string): string {
  return ended?.tenant ?? tenant;
}

export type TenantEntry =
  | { kind: 'allowed'; principal: Principal }
  | { kind: 'signing-in'; tenant: string; ended: boolean }
  | { kind: 'elsewhere'; principal: Principal };

export function tenantEntry(
  principal: Principal | null,
  ended: Principal | null,
  tenant: string,
): TenantEntry {
  if (principal === null) {
    return { kind: 'signing-in', tenant: signInHome(ended, tenant), ended: ended !== null };
  }
  return signedInElsewhere(principal, tenant)
    ? { kind: 'elsewhere', principal }
    : { kind: 'allowed', principal };
}
