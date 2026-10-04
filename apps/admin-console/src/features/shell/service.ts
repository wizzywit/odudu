import { holds, readable } from '#/shared/service/access.ts';
import {
  SYSTEM_TENANT,
  type AdminCapability,
  type Authority,
  type Principal,
} from '#/shared/service/principal.ts';

export interface Area {
  path: string;
  label: string;
  // What its first read needs, so the page can say so rather than be refused.
  capability: AdminCapability | null;
  // Whether it lists records and so pages through a cursor trail.
  list: boolean;
  // Pages beside its own path that belong to it, such as creation beside a
  // list, so the rail lights it there too.
  pages: readonly string[];
}

export interface RailLink {
  href: string;
  label: string;
  // The addresses of the pages beside it that it stands for.
  pages: readonly string[];
}

export interface RailSection {
  heading?: string;
  items: readonly RailLink[];
}

interface AreaGroup {
  heading?: string;
  areas: readonly Area[];
}

const area = (
  path: string,
  label: string,
  capability: AdminCapability | null,
  list = false,
  pages: readonly string[] = [],
): Area => ({ path, label, capability, list, pages });

export const OVERVIEW = area('', 'Overview', null);

// The tenant rail groups areas by task. Every area is its own route.
export const TENANT_AREAS: readonly AreaGroup[] = [
  { areas: [OVERVIEW] },
  {
    heading: 'Identity',
    areas: [
      area('subjects', 'Subjects', 'view-users', true),
      area('groups', 'Groups', 'manage-tenant', true),
      area('roles', 'Roles', 'manage-tenant', true),
    ],
  },
  {
    heading: 'Applications',
    areas: [
      area('clients', 'Clients', 'manage-clients', true),
      area('scopes', 'Scopes', 'manage-tenant', true),
      area('registration-tokens', 'Registration tokens', 'manage-clients', true),
    ],
  },
  {
    heading: 'Security',
    areas: [
      area('flow', 'Sign-in flow', 'manage-tenant'),
      area('keys', 'Signing keys', 'manage-keys'),
    ],
  },
  {
    heading: 'Tenant',
    areas: [
      area('settings', 'Settings', 'manage-tenant'),
      area('email', 'Email', 'manage-tenant'),
      area('export', 'Export', 'manage-tenant'),
    ],
  },
  { heading: 'Observe', areas: [area('audit', 'Audit trail', 'view-audit', true)] },
];

// Shown only to a system administrator signed in to `system`; the system
// tenant's own settings and audit are its ordinary tenant areas.
export const SYSTEM_AREAS: AreaGroup = {
  heading: 'System',
  areas: [
    area('tenants', 'Tenants', 'manage-tenants', true, ['new-tenant', 'import-tenant']),
    area('system-admins', 'System administrators', 'manage-tenants', true),
  ],
};

export const EVERY_AREA: readonly Area[] = [
  ...SYSTEM_AREAS.areas,
  ...TENANT_AREAS.flatMap((g) => g.areas),
];

export function areaAt(path: string): Area {
  const found = EVERY_AREA.find((a) => a.path === path);
  if (found === undefined) throw new Error(`no area is at "${path}"`);
  return found;
}

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
