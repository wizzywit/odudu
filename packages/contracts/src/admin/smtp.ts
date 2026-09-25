import { z } from 'zod';

// The password itself is never in this shape — `password_set` is the only
// signal a caller gets about it, whether reading a config just written or
// one from a previous session.
export const smtpConfigSchema = z.object({
  configured: z.boolean(),
  host: z.string().nullable(),
  port: z.number().int().nullable(),
  from_address: z.string().nullable(),
  username: z.string().nullable(),
  password_set: z.boolean(),
  starttls: z.boolean().nullable(),
});
export type SmtpConfig = z.infer<typeof smtpConfigSchema>;

// A full replace, the same shape `PUT /scopes/:id/roles` gives its role
// set: omitting `password` clears it rather than leaving a previous one in
// place, since GET never hands one back to resend unchanged.
export const putSmtpRequestSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
  from_address: z.string().min(1),
  username: z.string().min(1).nullable().optional(),
  password: z.string().min(1).nullable().optional(),
  starttls: z.boolean().optional(),
});
export type PutSmtpRequest = z.infer<typeof putSmtpRequestSchema>;

export const testSmtpRequestSchema = z.object({
  to: z.string().min(1),
});
export type TestSmtpRequest = z.infer<typeof testSmtpRequestSchema>;

export const testSmtpResponseSchema = z.object({
  sent: z.boolean(),
});
export type TestSmtpResponse = z.infer<typeof testSmtpResponseSchema>;
