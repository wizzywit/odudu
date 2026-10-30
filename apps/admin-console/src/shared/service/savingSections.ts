// The sections saving now, as `tenant/record/section` ids, and what a section
// reports when it starts or stops.
export function savingKey(tenant: string, record: string, section: string): string {
  return `${tenant}/${record}/${section}`;
}

export function savingToggled(
  saving: ReadonlySet<string>,
  key: string,
  now: boolean,
): ReadonlySet<string> | null {
  if (saving.has(key) === now) return null;
  const next = new Set(saving);
  if (now) next.add(key);
  else next.delete(key);
  return next;
}

// Whether any section of one tenant's record is saving.
export function anySaving(saving: ReadonlySet<string>, tenant: string, record: string): boolean {
  const prefix = `${tenant}/${record}/`;
  return [...saving].some((key) => key.startsWith(prefix));
}
