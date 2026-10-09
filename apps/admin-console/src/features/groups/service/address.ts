import type { Group, GroupRecord } from '@odudu/contracts/admin';
import type { Crumb } from '#/shared/service/breadcrumb.ts';
import { type Loss, type OwnAccess, type Asked } from '#/shared/service/capabilities';

export type { Group, GroupRecord };

export { lossText, possibleLoss } from '#/shared/service/capabilities';

export type { Loss, OwnAccess };

export function groupsHref(tenant: string): string {
  return `/console/${encodeURIComponent(tenant)}/groups`;
}

export function newGroupHref(tenant: string, parent?: string): string {
  const base = `${groupsHref(tenant)}/new`;
  return parent === undefined ? base : `${base}?parent=${encodeURIComponent(parent)}`;
}

export function groupHref(tenant: string, id: string): string {
  return `${groupsHref(tenant)}/${encodeURIComponent(id)}`;
}

// The rail group is a heading, not a page, so it has no address.
export function groupsTrail(tenant: string, current: string): readonly Crumb[] {
  return [{ label: 'Identity' }, { label: 'Groups', href: groupsHref(tenant) }, { label: current }];
}

export type { Asked };
