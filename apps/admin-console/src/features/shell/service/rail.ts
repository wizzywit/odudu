import { holds, readable } from '#/shared/service/access.ts';
import { SYSTEM_TENANT, type Authority, type Principal } from '#/shared/service/principal.ts';
import {
  type Area,
  OVERVIEW,
  type RailSection,
  SYSTEM_AREAS,
  TENANT_AREAS,
  areaAt,
} from '#/features/shell/service/areas.ts';

export { holds };

export function showsSystemArea(
  principal: Principal,
  tenant: string,
  authority: Authority | undefined,
): boolean {
  return (
    principal.tenant === SYSTEM_TENANT &&
    tenant === SYSTEM_TENANT &&
    holds(authority, 'manage-tenants')
  );
}

// A system administrator inside any other tenant acts with system authority,
// and the bar saying so is shown from the first render: whoami can only
// confirm it, never be waited for.
export function actsWithSystemAuthority(
  principal: Principal,
  tenant: string,
  authority: Authority | undefined,
): boolean {
  if (principal.tenant !== SYSTEM_TENANT || tenant === SYSTEM_TENANT) return false;
  return authority?.crossTenant ?? true;
}

export function areaHref(tenant: string, area: Area): string {
  const base = `/console/${encodeURIComponent(tenant)}`;
  return area.path === '' ? base : `${base}/${area.path}`;
}

// Where a system administrator entered this tenant from.
export function systemRecordHref(tenant: string): string {
  return `${areaHref(SYSTEM_TENANT, areaAt('tenants'))}/${encodeURIComponent(tenant)}`;
}

// The rail lists only what the caller can read; an address to any other
// area still opens, and says what it needs, since links get shared.
// While whoami is still being asked (`checking`) only what needs nothing is
// listed, so no area shows and then vanishes; a whoami that failed lists all.
export function railGroups(
  tenant: string,
  withSystem: boolean,
  authority?: Authority,
  checking = false,
): readonly RailSection[] {
  const groups = withSystem ? [SYSTEM_AREAS, ...TENANT_AREAS] : TENANT_AREAS;
  const shown = (a: Area): boolean =>
    checking && authority === undefined ? a.capability === null : readable(authority, a.capability);
  return groups.flatMap((group) => {
    const areas = group.areas.filter(shown);
    if (areas.length === 0) return [];
    return [
      {
        ...(group.heading === undefined ? {} : { heading: group.heading }),
        items: areas.map((a) => ({
          href: areaHref(tenant, a),
          label: a.label,
          pages: a.pages.map((page) => `${areaHref(tenant, OVERVIEW)}/${page}`),
        })),
      },
    ];
  });
}

// The deepest rail entry the page sits under, a segment at a time, so a
// record page lights its area and the overview lights only itself.
export function currentHref(
  tenant: string,
  groups: readonly RailSection[],
  pathname: string,
): string | undefined {
  const overview = areaHref(tenant, OVERVIEW);
  const page = pathname.replace(/\/$/u, '');
  const under = (href: string): boolean =>
    page === href || (href !== overview && page.startsWith(`${href}/`));
  return groups
    .flatMap((group) => group.items)
    .flatMap((item) => [item.href, ...item.pages].filter(under).map((at) => ({ item, at })))
    .sort((a, b) => b.at.length - a.at.length)[0]?.item.href;
}
