import { create } from 'zustand';
import { loadDrafts, storeDrafts } from '#/shared/adapter/draftStorage.ts';
import {
  keepableValues,
  withoutDraft,
  type DraftField,
  type DraftFields,
  type DraftValues,
  type KeptDraft,
} from '#/shared/service/drafts.ts';

export type { DraftField, DraftFields, DraftValues, KeptDraft };

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
      const values = keepableValues(source.fields());
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
    storeDrafts({ owner: stored.owner, drafts: withoutDraft(stored.drafts, record, section) });
  },
  adopt: (owner) => {
    const stored = loadDrafts();
    if (stored !== null && stored.owner !== owner) storeDrafts(null);
  },
  forgetAll: () => {
    storeDrafts(null);
  },
}));

// The store's functions for a hook to hold: the compiler refuses a method
// read off a hook.
export function currentDrafts(): ReturnType<typeof useDrafts.getState> {
  return useDrafts.getState();
}
