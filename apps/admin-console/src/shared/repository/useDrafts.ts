import { create } from 'zustand';
import { loadDrafts, storeDrafts } from '#/shared/adapter/draftStorage.ts';

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

export interface DraftSource {
  record: string;
  section: string;
  dirty: () => boolean;
  // The section's edits, not its whole record: a restore lands on a fresh read.
  fields: () => DraftFields;
  etag: () => string | null;
}

interface Drafts {
  register: (source: DraftSource) => () => void;
  // Writes every dirty section's non-secret edits; answers how many sections.
  keepDirty: (owner: string) => number;
  restore: (record: string, section: string) => KeptDraft | null;
  forget: (record: string, section: string) => void;
  // Drops drafts some other administrator left in this tab.
  adopt: (owner: string) => void;
  forgetAll: () => void;
}

function keepable(fields: DraftFields): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, field]) => field.kind === 'plain')
      .map(([name, field]) => [name, field.value]),
  );
}

const sources = new Set<DraftSource>();

export const useDrafts = create<Drafts>()(() => ({
  register: (source) => {
    sources.add(source);
    return () => {
      sources.delete(source);
    };
  },
  keepDirty: (owner) => {
    const previous = loadDrafts();
    const drafts = previous?.owner === owner ? { ...previous.drafts } : {};
    let kept = 0;
    for (const source of sources) {
      if (!source.dirty()) continue;
      const values = keepable(source.fields());
      if (Object.keys(values).length === 0) continue;
      drafts[source.record] = {
        ...drafts[source.record],
        [source.section]: { values, etag: source.etag() },
      };
      kept += 1;
    }
    storeDrafts({ owner, drafts });
    return kept;
  },
  restore: (record, section) => loadDrafts()?.drafts[record]?.[section] ?? null,
  forget: (record, section) => {
    const stored = loadDrafts();
    if (stored?.drafts[record]?.[section] === undefined) return;
    const rest = Object.entries(stored.drafts[record]).filter(([name]) => name !== section);
    const others = Object.entries(stored.drafts).filter(([name]) => name !== record);
    const drafts = Object.fromEntries(
      rest.length > 0 ? [...others, [record, Object.fromEntries(rest)]] : others,
    );
    storeDrafts({ owner: stored.owner, drafts });
  },
  adopt: (owner) => {
    const stored = loadDrafts();
    if (stored !== null && stored.owner !== owner) storeDrafts(null);
  },
  forgetAll: () => {
    storeDrafts(null);
  },
}));
