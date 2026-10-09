import { type AdminCapability } from '#/shared/service/principal.ts';

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
