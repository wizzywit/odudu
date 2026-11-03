import { create } from 'zustand';
import { loadDrafts, storeDrafts } from '#/shared/api/adapter/draftStorage';
import {
  foreignTo,
  isKept,
  keptDrafts,
  withoutDraft,
  type DraftField,
  type DraftFields,
  type DraftValues,
  type KeptDraft,
} from '#/shared/lib/services/drafts';

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
  // Forgets the registered sections as well, which only a registry held in
  // the closure can be made to do; a test that registered one directly needs it.
  reset: () => void;
}

export const useDrafts = create<Drafts>()((_set, get) => {
  const sources = new Set<DraftSource>();
  return {
    register: (source) => {
      sources.add(source);
      return () => {
        sources.delete(source);
      };
    },
    keepDirty: (owner) => {
      const { drafts, kept } = keptDrafts(
        loadDrafts(),
        owner,
        [...sources].map((source) => ({
          record: source.record,
          section: source.section,
          dirty: source.dirty(),
          fields: source.fields(),
          etag: source.etag(),
        })),
      );
      storeDrafts({ owner, drafts });
      return kept;
    },
    restore: (record, section) => loadDrafts()?.drafts[record]?.[section] ?? null,
    forget: (record, section) => {
      const stored = loadDrafts();
      if (stored === null || !isKept(stored, record, section)) return;
      storeDrafts({ owner: stored.owner, drafts: withoutDraft(stored.drafts, record, section) });
    },
    adopt: (owner) => {
      const stored = loadDrafts();
      if (foreignTo(stored, owner)) storeDrafts(null);
    },
    forgetAll: () => {
      storeDrafts(null);
    },
    reset: () => {
      sources.clear();
      get().forgetAll();
    },
  };
});
