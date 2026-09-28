import { z } from 'zod';

const KEY = 'odudu.console.drafts';

const storedSchema = z.object({
  owner: z.string(),
  drafts: z.record(z.string(), z.record(z.string(), z.record(z.string(), z.unknown()))),
});

// Record, then section, then field, to the value kept for it.
export type StoredDrafts = z.infer<typeof storedSchema>;

// Every access is guarded: a private window or blocked site data refuses
// storage, sometimes at the getter, and then a draft is simply not kept.
function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function loadDrafts(): StoredDrafts | null {
  try {
    const text = storage()?.getItem(KEY);
    if (text === null || text === undefined) return null;
    const parsed = storedSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function storeDrafts(stored: StoredDrafts | null): void {
  try {
    if (stored === null || Object.keys(stored.drafts).length === 0) storage()?.removeItem(KEY);
    else storage()?.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Unkept, the draft is lost with the session, which is where it started.
  }
}
