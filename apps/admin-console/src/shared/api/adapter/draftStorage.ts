import { z } from 'zod';
import { browserStorage } from '#/shared/api/adapter/browserStorage';

const KEY = 'odudu.console.drafts';

const storedSchema = z.object({
  owner: z.string(),
  drafts: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({ etag: z.string().nullable(), values: z.record(z.string(), z.unknown()) }),
    ),
  ),
});

// Record, then section, to the values kept for it and the ETag they were
// made against.
export type StoredDrafts = z.infer<typeof storedSchema>;

export function loadDrafts(): StoredDrafts | null {
  try {
    const text = browserStorage('session')?.getItem(KEY);
    if (text === null || text === undefined) return null;
    const parsed = storedSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function storeDrafts(stored: StoredDrafts | null): void {
  try {
    if (stored === null || Object.keys(stored.drafts).length === 0)
      browserStorage('session')?.removeItem(KEY);
    else browserStorage('session')?.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Unkept, the draft is lost with the session, which is where it started.
  }
}
