import { z } from 'zod';
import { create } from 'zustand';

// A field flagged secret — a client secret, a password — is never written.
export interface DraftField {
  readonly value: unknown;
  readonly secret?: boolean;
}
export type DraftFields = Readonly<Record<string, DraftField>>;
export type DraftValues = Readonly<Record<string, unknown>>;

export interface DraftSource {
  readonly record: string;
  readonly section: string;
  readonly dirty: () => boolean;
  // The section's edits, not its whole record: a restore lands on a fresh read.
  readonly fields: () => DraftFields;
}

interface Drafts {
  readonly register: (source: DraftSource) => () => void;
  // Writes every dirty section's non-secret edits; answers how many sections.
  readonly keepDirty: (owner: string) => number;
  readonly restore: (record: string, section: string) => DraftValues | null;
  readonly forget: (record: string, section: string) => void;
  // Drops drafts some other administrator left in this tab.
  readonly adopt: (owner: string) => void;
  readonly forgetAll: () => void;
}

const KEY = 'odudu.console.drafts';

const storedSchema = z.object({
  owner: z.string(),
  drafts: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown()))),
});
type Stored = z.infer<typeof storedSchema>;

// Every access is guarded: a private window or blocked site data refuses
// storage, sometimes at the getter, and then a draft is simply not kept.
function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function read(): Stored | null {
  try {
    const text = storage()?.getItem(KEY);
    if (text === null || text === undefined) return null;
    const parsed = storedSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function write(stored: Stored | null): void {
  try {
    if (stored === null || Object.keys(stored.drafts).length === 0) storage()?.removeItem(KEY);
    else storage()?.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Unkept, the draft is lost with the session, which is where it started.
  }
}

function keepable(fields: DraftFields): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, field]) => field.secret !== true)
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
    const previous = read();
    const drafts = previous?.owner === owner ? { ...previous.drafts } : {};
    let kept = 0;
    for (const source of sources) {
      if (!source.dirty()) continue;
      const values = keepable(source.fields());
      if (Object.keys(values).length === 0) continue;
      drafts[source.record] = { ...drafts[source.record], [source.section]: values };
      kept += 1;
    }
    write({ owner, drafts });
    return kept;
  },
  restore: (record, section) => read()?.drafts[record]?.[section] ?? null,
  forget: (record, section) => {
    const stored = read();
    if (stored?.drafts[record]?.[section] === undefined) return;
    const rest = Object.entries(stored.drafts[record]).filter(([name]) => name !== section);
    const others = Object.entries(stored.drafts).filter(([name]) => name !== record);
    const drafts = Object.fromEntries(
      rest.length > 0 ? [...others, [record, Object.fromEntries(rest)]] : others,
    );
    write({ owner: stored.owner, drafts });
  },
  adopt: (owner) => {
    const stored = read();
    if (stored !== null && stored.owner !== owner) write(null);
  },
  forgetAll: () => {
    write(null);
  },
}));
