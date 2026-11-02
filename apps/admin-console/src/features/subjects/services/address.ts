import { type Credential, type Lockout, type Profile, type Subject } from '@odudu/contracts/admin';
import { resourceAddress, withSearch } from '#/shared/services/address';
import { nameOrId } from '#/shared/services/ids';
import { type AdminCapability } from '#/shared/services/principal';

export type { Credential, Lockout, Profile, Subject };

const subjects = resourceAddress({ segment: 'subjects', group: 'Identity', label: 'Subjects' });

export const {
  listHref: subjectsHref,
  newHref: newSubjectHref,
  recordHref: subjectHref,
  trail: subjectsTrail,
} = subjects;

export function subjectName(subject: Pick<Subject, 'id' | 'type' | 'username'>): string {
  return nameOrId(subject, subject.type);
}

export function createSubjectHref(
  tenant: string,
  lacking: readonly AdminCapability[],
): string | null {
  return lacking.length === 0 ? newSubjectHref(tenant) : null;
}

export function membersListHref(tenant: string, by: 'group' | 'role', id: string): string {
  return withSearch(subjectsHref(tenant), { [by]: id });
}
