// Every field says whether it is secret, with no default, so a new password
// or client-secret field cannot reach sessionStorage by omission.
export interface DraftField {
  kind: 'plain' | 'secret';
  value: unknown;
}
export type DraftFields = Readonly<Record<string, DraftField>>;
export type DraftValues = Readonly<Record<string, unknown>>;

// A draft is saved with the ETag its section loaded, never a fresh one, so a
// change somebody made meanwhile answers 412 rather than being overwritten.
export interface KeptDraft {
  values: DraftValues;
  etag: string | null;
}

export type StoredRecords = Readonly<Record<string, Readonly<Record<string, KeptDraft>>>>;

export function keepableValues(fields: DraftFields): DraftValues {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, field]) => field.kind === 'plain')
      .map(([name, field]) => [name, field.value]),
  );
}

// The edits as drafts: a field the section does not know is treated as secret.
export function draftFieldsOf(
  edits: Readonly<Record<string, unknown>>,
  kinds: Readonly<Record<string, { kind: 'plain' | 'secret' } | undefined>>,
): DraftFields {
  return Object.fromEntries(
    Object.entries(edits).map(([name, value]) => [
      name,
      { kind: kinds[name]?.kind ?? 'secret', value },
    ]),
  );
}

export function withoutDraft(
  drafts: StoredRecords,
  record: string,
  section: string,
): StoredRecords {
  const kept = drafts[record];
  if (kept?.[section] === undefined) return drafts;
  const rest = Object.entries(kept).filter(([name]) => name !== section);
  const others = Object.entries(drafts).filter(([name]) => name !== record);
  return Object.fromEntries(
    rest.length > 0 ? [...others, [record, Object.fromEntries(rest)]] : others,
  );
}
