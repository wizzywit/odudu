import { z } from 'zod';
import { cursorQuerySchema, DEFAULT_LIMIT, MAX_LIMIT } from '#/admin/shared';

export { DEFAULT_LIMIT, MAX_LIMIT } from '#/admin/shared';

// The page a list is read at. No member names a subject: the token's own is
// the only one a "me" route reads.
export const meListQuerySchema = cursorQuerySchema
  .extend({
    cursor: cursorQuerySchema.shape.cursor.describe(
      'Where the page starts: the `next_cursor` of the previous page. Treat it as opaque. Omit it for the first page; one that is malformed or belongs to another list is refused with `400`.',
    ),
    limit: cursorQuerySchema.shape.limit.describe(
      `The most entries to return, at least 1. The default is ${String(DEFAULT_LIMIT)}; a value above ${String(MAX_LIMIT)} is lowered to ${String(MAX_LIMIT)}, not refused.`,
    ),
  })
  .strict();
export type MeListQuery = z.infer<typeof meListQuerySchema>;

// The query of a read that takes none: any member is refused.
export const meNoQuerySchema = z.object({}).strict();

// A list is a page and the cursor of the next, or null where there is none.
// `entries` names what the items are, for the description of the array.
export function mePage<Item extends z.ZodType>(item: Item, entries: string) {
  return z.object({
    items: z.array(item).describe(`The ${entries} on this page.`),
    next_cursor: z
      .string()
      .nullable()
      .describe(
        'The `cursor` that reads the next page, or null on the last page. Treat it as opaque.',
      ),
  });
}

// The body of a refused request, in the shape OAuth 2.0 errors have.
export const meErrorSchema = z.object({
  error: z
    .string()
    .describe(
      'A short code for the refusal, such as `invalid_request`, `not_found`, `conflict`, `agent_not_permitted` or `mail_unavailable`; a refused removal of a sign-in method names which rule it broke.',
    ),
  error_description: z
    .string()
    .describe(
      'A sentence in English that says what was wrong. It is for a person to read; match on `error`, not on this text.',
    ),
});
export type MeError = z.infer<typeof meErrorSchema>;
