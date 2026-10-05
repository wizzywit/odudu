import type { Role } from '@odudu/contracts/admin';
import type { Crumb } from '#/shared/service/breadcrumb.ts';

export type { Role };

export function rolesHref(tenant: string): string {
  return `/console/${encodeURIComponent(tenant)}/roles`;
}

export function newRoleHref(tenant: string): string {
  return `${rolesHref(tenant)}/new`;
}

export function copyHref(tenant: string, id: string): string {
  return `${newRoleHref(tenant)}?copy=${encodeURIComponent(id)}`;
}

export function roleHref(tenant: string, id: string): string {
  return `${rolesHref(tenant)}/${encodeURIComponent(id)}`;
}

// The rail group is a heading, not a page, so it has no address.
export function rolesTrail(tenant: string, current: string): readonly Crumb[] {
  return [{ label: 'Identity' }, { label: 'Roles', href: rolesHref(tenant) }, { label: current }];
}

// A copy is a tenant role, so only a tenant role offers one.
export function copyHrefOf(tenant: string, role: Role | undefined): string | null {
  return role?.client_id === null ? copyHref(tenant, role.id) : null;
}
