import type { Crumb } from '#/shared/lib/services/breadcrumb';
import { stringifySearch } from '#/shared/lib/services/search';

// Where the console starts, before any tenant is named.
export const CONSOLE_ROOT = '/console/';

// The system area's own address, under which tenants and system administrators sit.
export const SYSTEM_BASE = '/console/system';

export function tenantPage(tenant: string): string {
  return `/console/${encodeURIComponent(tenant)}`;
}

// A record under its list, its id encoded.
export function recordAddress(listHref: string, id: string): string {
  return `${listHref}/${encodeURIComponent(id)}`;
}

// A page's address with its query parameters; a parameter left undefined is left out.
// Encoded as a query (a space is `+`), so it takes values, never path parts.
export function withSearch(href: string, search: Record<string, string | undefined>): string {
  return `${href}${stringifySearch(search)}`;
}

interface ResourceNames {
  // The path segment under the tenant: "clients".
  segment: string;
  // The rail group the list sits under, which is a heading and has no address.
  group: string;
  // The list's own name in a breadcrumb: "Clients".
  label: string;
}

export interface ResourceAddress {
  listHref: (tenant: string) => string;
  newHref: (tenant: string) => string;
  recordHref: (tenant: string, id: string) => string;
  trail: (tenant: string, current: string) => readonly Crumb[];
}

// The addresses of a resource's list, its creation page and its records,
// each tenant and id encoded, and the breadcrumb to a record.
export function resourceAddress({ segment, group, label }: ResourceNames): ResourceAddress {
  const listHref = (tenant: string): string => `${tenantPage(tenant)}/${segment}`;
  return {
    listHref,
    newHref: (tenant) => `${listHref(tenant)}/new`,
    recordHref: (tenant, id) => recordAddress(listHref(tenant), id),
    trail: (tenant, current) => [
      { label: group },
      { label, href: listHref(tenant) },
      { label: current },
    ],
  };
}

// What the area gate shows in place of a page it does not let through.
export interface PageFrame {
  title: string;
  breadcrumb: readonly Crumb[];
}

export function pageFrame(
  trail: (tenant: string, current: string) => readonly Crumb[],
  tenant: string,
  title: string,
): PageFrame {
  return { title, breadcrumb: trail(tenant, title) };
}
