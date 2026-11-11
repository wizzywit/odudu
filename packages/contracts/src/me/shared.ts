import { z } from 'zod';
import { cursorQuerySchema } from '#/admin/shared';

export { DEFAULT_LIMIT, MAX_LIMIT } from '#/admin/shared';

// The page a list is read at. No member names a subject: the token's own is
// the only one a "me" route reads.
export const meListQuerySchema = cursorQuerySchema.strict();
export type MeListQuery = z.infer<typeof meListQuerySchema>;

// A list is a page and the cursor of the next, or null where there is none.
export function mePage<Item extends z.ZodType>(item: Item) {
  return z.object({ items: z.array(item), next_cursor: z.string().nullable() });
}
