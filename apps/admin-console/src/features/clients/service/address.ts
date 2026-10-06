import type { Crumb } from '#/shared/service/breadcrumb.ts';

export function clientsHref(tenant: string): string {
  return `/console/${encodeURIComponent(tenant)}/clients`;
}

export function newClientHref(tenant: string): string {
  return `${clientsHref(tenant)}/new`;
}

export function clientHref(tenant: string, id: string): string {
  return `${clientsHref(tenant)}/${encodeURIComponent(id)}`;
}

// The rail group is a heading, not a page, so it has no address.
export function clientsTrail(tenant: string, current: string): readonly Crumb[] {
  return [
    { label: 'Applications' },
    { label: 'Clients', href: clientsHref(tenant) },
    { label: current },
  ];
}
