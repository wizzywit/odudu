import { z } from 'zod';
import { createdAtSchema, cursorQuerySchema } from '#/admin/shared';

// The version of the tenant's terms a subject accepted, and when.
export const termsAcceptanceSchema = z.object({
  version: z.string(),
  accepted_at: createdAtSchema,
});
export type TermsAcceptance = z.infer<typeof termsAcceptanceSchema>;

export const listTermsAcceptancesQuerySchema = cursorQuerySchema.strict();
export type ListTermsAcceptancesQuery = z.infer<typeof listTermsAcceptancesQuerySchema>;

// One row for each version a subject accepted, newest first, so the list is paged.
export const listTermsAcceptancesResponseSchema = z.object({
  items: z.array(termsAcceptanceSchema),
  next: z.string().optional(),
});
export type ListTermsAcceptancesResponse = z.infer<typeof listTermsAcceptancesResponseSchema>;
