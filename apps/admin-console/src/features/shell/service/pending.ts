import { holds } from '#/shared/service/access.ts';
import {
  isTenantName,
  SYSTEM_TENANT,
  type Authority,
  type Principal,
} from '#/shared/service/principal.ts';
import { type Area, EVERY_AREA, OVERVIEW, SYSTEM_AREAS } from '#/features/shell/service/areas.ts';
import { showsSystemArea } from '#/features/shell/service/rail.ts';

export type PendingShape = 'overview' | 'list' | 'record' | 'form' | 'page';

export interface PendingPage {
  tenant: string;
  shape: PendingShape;
  // Known only where an area names the page; a record's title is its own.
  title: string | null;
}

// What an address will draw once the session is read, so the console's own
// frame can hold its place: a table for a list, the overview's panels for
// the root. Null where no tenant is named, and the tenant question comes
// first.
export function pendingPage(pathname: string): PendingPage | null {
  const [tenant, ...rest] = pathname
    .replace(/^\/console(?=\/|$)/u, '')
    .split('/')
    .filter((segment) => segment !== '')
    .map(decodeURIComponent);
  if (tenant === undefined || !isTenantName(tenant)) return null;
  const [first, second, third] = rest;
  if (first === undefined) return { tenant, shape: 'overview', title: OVERVIEW.label };
  const owner = EVERY_AREA.find((a) => a.path === first);
  if (second === undefined) {
    if (owner !== undefined) {
      return { tenant, shape: owner.list ? 'list' : 'form', title: owner.label };
    }
    const creating = EVERY_AREA.some((a) => a.pages.includes(first));
    return { tenant, shape: creating ? 'form' : 'page', title: null };
  }
  if (owner?.list !== true) return { tenant, shape: 'page', title: null };
  const creating = second === 'new' || third === 'new-administrator';
  return { tenant, shape: creating ? 'form' : 'record', title: null };
}

export type AreaAccess =
  | { kind: 'hidden' }
  | { kind: 'checking' }
  | { kind: 'refused'; capability: NonNullable<Area['capability']> }
  | { kind: 'open' };

// whoami is advice: an area whose capability it says is missing explains
// what it needs instead of offering reads the server would refuse.
export function areaAccess(
  principal: Principal,
  tenant: string,
  authority: Authority | undefined,
  area: Area,
): AreaAccess {
  const system = SYSTEM_AREAS.areas.includes(area);
  if (system && (principal.tenant !== SYSTEM_TENANT || tenant !== SYSTEM_TENANT)) {
    return { kind: 'hidden' };
  }
  if (area.capability === null) return { kind: 'open' };
  if (authority === undefined) return system ? { kind: 'checking' } : { kind: 'open' };
  if (system && !showsSystemArea(principal, tenant, authority)) return { kind: 'hidden' };
  return holds(authority, area.capability)
    ? { kind: 'open' }
    : { kind: 'refused', capability: area.capability };
}
