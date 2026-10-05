import { type Credential, type Lockout, type Profile, type Subject } from '@odudu/contracts/admin';
import type { Crumb } from '#/shared/service/breadcrumb.ts';
import { type AdminCapability } from '#/shared/service/principal.ts';

export type { Credential, Lockout, Profile, Subject };

export function subjectsHref(tenant: string): string {
  return `/console/${encodeURIComponent(tenant)}/subjects`;
}

export function newSubjectHref(tenant: string): string {
  return `${subjectsHref(tenant)}/new`;
}

export function subjectHref(tenant: string, id: string): string {
  return `${subjectsHref(tenant)}/${encodeURIComponent(id)}`;
}

// The rail group is a heading, not a page, so it has no address.
export function subjectsTrail(tenant: string, current: string): readonly Crumb[] {
  return [
    { label: 'Identity' },
    { label: 'Subjects', href: subjectsHref(tenant) },
    { label: current },
  ];
}

export function subjectName(subject: Pick<Subject, 'id' | 'type' | 'username'>): string {
  return subject.username ?? `${subject.type} ${subject.id}`;
}

export function createSubjectHref(
  tenant: string,
  lacking: readonly AdminCapability[],
): string | null {
  return lacking.length === 0 ? newSubjectHref(tenant) : null;
}

export function membersListHref(tenant: string, by: 'group' | 'role', id: string): string {
  return `${subjectsHref(tenant)}?${new URLSearchParams({ [by]: id }).toString()}`;
}
