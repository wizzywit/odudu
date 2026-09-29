import {
  SYSTEM_TENANT,
  type AdminCapability,
  type Authority,
  type Principal,
} from '#/shared/service/principal.ts';

export interface Area {
  readonly path: string;
  readonly label: string;
  // What its first read needs, so the page can say so rather than be refused.
  readonly capability: AdminCapability | null;
  // Whether it lists records and so pages through a cursor trail.
  readonly list: boolean;
}

export interface RailLink {
  readonly href: string;
  readonly label: string;
}

export interface RailSection {
  readonly heading?: string;
  readonly items: readonly RailLink[];
}

interface AreaGroup {
  readonly heading?: string;
  readonly areas: readonly Area[];
}

const area = (
  path: string,
  label: string,
  capability: AdminCapability | null,
  list = false,
): Area => ({ path, label, capability, list });

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
    area('tenants', 'Tenants', 'manage-tenants', true),
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

export function holds(authority: Authority | undefined, capability: AdminCapability): boolean {
  return authority?.capabilities.includes(capability) === true;
}

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

export function railGroups(tenant: string, withSystem: boolean): readonly RailSection[] {
  const groups = withSystem ? [SYSTEM_AREAS, ...TENANT_AREAS] : TENANT_AREAS;
  return groups.map((group) => ({
    ...(group.heading === undefined ? {} : { heading: group.heading }),
    items: group.areas.map((a) => ({ href: areaHref(tenant, a), label: a.label })),
  }));
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
  return groups
    .flatMap((group) => group.items.map((item) => item.href))
    .filter((href) => page === href || (href !== overview && page.startsWith(`${href}/`)))
    .sort((a, b) => b.length - a.length)[0];
}
