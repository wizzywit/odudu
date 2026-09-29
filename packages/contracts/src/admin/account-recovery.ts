import { z } from 'zod';

// The only place an issued password is ever written down: never stored in
// the clear, never logged, never in an audit row.
export const issuePasswordResponseSchema = z.object({
  password: z.string(),
});
export type IssuePasswordResponse = z.infer<typeof issuePasswordResponseSchema>;
