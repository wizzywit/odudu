import { z } from 'zod';
import { cursorQuerySchema } from '#/admin/shared';

export { DEFAULT_LIMIT, MAX_LIMIT } from '#/admin/shared';

// The page a list is read at. No member names a subject: the token's own is
// the only one a "me" route reads.
export const meListQuerySchema = cursorQuerySchema.strict();
export type MeListQuery = z.infer<typeof meListQuerySchema>;

// The query of a read that takes none: any member is refused.
export const meNoQuerySchema = z.object({}).strict();

// A list is a page and the cursor of the next, or null where there is none.
export function mePage<Item extends z.ZodType>(item: Item) {
  return z.object({ items: z.array(item), next_cursor: z.string().nullable() });
}

// The body of a refused request, in the shape OAuth 2.0 errors have.
export const meErrorSchema = z.object({ error: z.string(), error_description: z.string() });
export type MeError = z.infer<typeof meErrorSchema>;
