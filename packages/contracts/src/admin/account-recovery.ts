import { z } from 'zod';
import { dateTimeSchema } from '#/admin/shared';

// The only place an issued password is ever written down: never stored in
// the clear, never logged, never in an audit row.
export const issuePasswordResponseSchema = z.object({
  password: z.string(),
});
export type IssuePasswordResponse = z.infer<typeof issuePasswordResponseSchema>;

// The run of failed sign-ins on record. `locked` is judged by the server's
// clock, so a caller never compares `locked_until` against its own. A
// subject that has never failed answers a zero count and nulls.
export const lockoutSchema = z.object({
  locked: z.boolean(),
  locked_until: dateTimeSchema.nullable(),
  failure_count: z.number().int(),
  last_failure_at: dateTimeSchema.nullable(),
});
export type Lockout = z.infer<typeof lockoutSchema>;
