import { holds, readable } from '#/shared/service/access.ts';
import {
  isTenantName,
  SYSTEM_TENANT,
  type AdminCapability,
  type Authority,
  type Principal,
} from '#/shared/service/principal.ts';
import type { ThemeChoice } from '#/shared/service/theme.ts';

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

export function brandText(tenant: string): string {
  return `odudu · ${tenant}`;
}

export function areasLabel(tenant: string): string {
  return `Areas of ${tenant}`;
}

// Whose session it is, when it was issued by another tenant.
export function signedInFrom(signedInTo: string, tenant: string): string | null {
  return signedInTo === tenant ? null : signedInTo;
}

export function checkingText(area: Area): string {
  return `Checking access to ${area.label}`;
}

export function notBuiltText(area: Area): string {
  return `${area.label} is not in this build of the console yet.`;
}

export function tenantNotFoundText(tenant: string): string {
  return `No tenant is named ${tenant}.`;
}

// A shortcut is paused while a dialog is open, the unsaved-changes guard's
// own included.
export function dialogOpen(openDialogs: number, guardAsking: boolean): boolean {
  return openDialogs > 0 || guardAsking;
}

export function pathnameOf(href: string, base: string): string {
  return new URL(href, base).pathname;
}

export const THEME_CHOICES: readonly { id: ThemeChoice; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export function themeChoice(value: string): ThemeChoice | undefined {
  return THEME_CHOICES.find((c) => c.id === value)?.id;
}
