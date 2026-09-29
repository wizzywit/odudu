import type { CountResponse, Subject } from '@odudu/contracts/admin';

export type { Subject };

export function subjectName(subject: Pick<Subject, 'id' | 'username'>): string {
  return subject.username ?? subject.id;
}

export function confirmationText(subject: Pick<Subject, 'id' | 'username'>): string {
  return subjectName(subject);
}

// The last-administrator guard refuses to leave system with no enabled
// holder of manage-tenants, so the one there is cannot be revoked; a
// disabled holder is not counted and can be.
export function onlyHolderOf<S extends Pick<Subject, 'enabled'>>(
  rows: readonly S[],
  enabledHolders: CountResponse | null,
): S | null {
  if (enabledHolders === null || enabledHolders.capped || enabledHolders.count !== 1) return null;
  const enabled = rows.filter((row) => row.enabled);
  return enabled.length === 1 ? (enabled[0] ?? null) : null;
}

export function onlyHolderReason(subject: Pick<Subject, 'id' | 'username'>): string {
  return `${subjectName(subject)} is the only enabled system administrator, so revoking them is refused: system would be left with nobody who holds manage-tenants. Add another first.`;
}

export function revokeConsequence(
  subject: Pick<Subject, 'id' | 'username'>,
  self: boolean,
): string {
  if (self) {
    return 'You are revoking your own system administration: tenant-admin and manage-tenants in system. Once it lands you can no longer reach the System area or any other tenant, and this console keeps only what your other roles give you.';
  }
  return `${subjectName(subject)} loses tenant-admin and manage-tenants in system, and with them every other tenant. Their other roles are kept. manage-tenants held through a group, or a role that nests it, stays until it is changed there.`;
}
