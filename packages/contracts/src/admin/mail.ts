import { z } from 'zod';
import { createdAtSchema, cursorQuerySchema, dateTimeSchema, idSchema } from '#/admin/shared';

// `failed` has spent every attempt the sender makes and will not be offered
// again; `retrying` failed at least once and will be; `queued` has not been
// tried, or was claimed and has not yet reported back.
export const OUTBOX_STATUSES = ['queued', 'retrying', 'sent', 'failed'] as const;
export const outboxStatusSchema = z.enum(OUTBOX_STATUSES);

export const listMailQuerySchema = cursorQuerySchema
  .extend({ status: outboxStatusSchema.optional() })
  .strict();
export type ListMailQuery = z.infer<typeof listMailQuerySchema>;

// Never the body: it carries the link a recipient signs in with. `to` is
// masked, and `to_masked` true, unless the caller can read subjects.
export const mailMessageSchema = z.object({
  id: idSchema,
  to: z.string(),
  to_masked: z.boolean(),
  subject: z.string(),
  status: outboxStatusSchema,
  attempts: z.number().int().nonnegative(),
  last_error: z.string().nullable(),
  created_at: createdAtSchema,
  next_attempt_at: dateTimeSchema,
  sent_at: dateTimeSchema.nullable(),
});
export type MailMessage = z.infer<typeof mailMessageSchema>;

export const listMailResponseSchema = z.object({
  items: z.array(mailMessageSchema),
  next: z.string().optional(),
});
export type ListMailResponse = z.infer<typeof listMailResponseSchema>;
