import { z } from 'zod';
import type { Creation } from '#/features/tenants/service.ts';

const KEY = 'odudu.console.tenant-creation';

// Unknown members are dropped, so nothing reaches storage but these.
const creationSchema = z.discriminatedUnion('step', [
  z.object({ step: z.literal('tenant'), name: z.string(), displayName: z.string() }),
  z.object({
    step: z.literal('administrator'),
    tenant: z.string(),
    origin: z.enum(['created', 'imported', 'existing']),
    username: z.string(),
    email: z.string(),
    subjectId: z.string().nullable(),
    granted: z.boolean(),
  }),
  z.object({ step: z.literal('done'), tenant: z.string(), username: z.string() }),
]);

const storedSchema = z.object({ owner: z.string(), creation: creationSchema });

// Every access is guarded: storage that refuses means a reload starts over.
function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function loadCreation(owner: string): Creation | null {
  try {
    const text = storage()?.getItem(KEY);
    if (text === null || text === undefined) return null;
    const parsed = storedSchema.safeParse(JSON.parse(text));
    return parsed.success && parsed.data.owner === owner ? parsed.data.creation : null;
  } catch {
    return null;
  }
}

export function storeCreation(owner: string, creation: Creation | null): void {
  try {
    if (creation === null) {
      storage()?.removeItem(KEY);
      return;
    }
    const stored = storedSchema.parse({ owner, creation });
    storage()?.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Unkept, a reload starts the creation over from what the server holds.
  }
}
