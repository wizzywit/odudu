import type { Subject } from '@odudu/contracts/admin';

export type { Subject };

export function subjectName(subject: Pick<Subject, 'id' | 'username'>): string {
  return subject.username ?? subject.id;
}

// A subject holding something already is changed in the list, not given it again.
export function pickerUnavailable(
  holders: ReadonlySet<string> | null,
  subject: Pick<Subject, 'id'>,
): string | null {
  return holders?.has(subject.id) === true
    ? 'already holds a capability: change it in the list'
    : null;
}

export function choosable(
  id: string | null,
  holders: ReadonlySet<string> | null,
  options: readonly Subject[],
): Subject | null {
  if (id === null || holders?.has(id) === true) return null;
  return options.find((option) => option.id === id) ?? null;
}

// The holders a picker search found, once the read has answered with a list.
export function holderSet(ids: readonly string[] | null | undefined): ReadonlySet<string> | null {
  return ids === undefined || ids === null ? null : new Set(ids);
}

// One page of the holders of any admin capability among what a search matches.
export function holdersParams(query: string, cursor: string | undefined): URLSearchParams {
  const params = new URLSearchParams({ capability: 'any' });
  if (query !== '') params.set('username', query);
  if (cursor !== undefined) params.set('cursor', cursor);
  return params;
}
