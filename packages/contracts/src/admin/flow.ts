import { z } from 'zod';

// `authentication_executions_requirement`
// (packages/db/drizzle/0031_authentication_executions.sql): the same four
// values, restated here as the one wire vocabulary a request or response
// carries.
export const executionRequirementSchema = z.enum([
  'required',
  'alternative',
  'conditional',
  'disabled',
]);
export type ExecutionRequirement = z.infer<typeof executionRequirementSchema>;

export const executionStepSchema = z.object({
  index: z.number().int().nonnegative(),
  authenticator: z.string(),
  requirement: executionRequirementSchema,
});
export type ExecutionStep = z.infer<typeof executionStepSchema>;

export const listExecutionsResponseSchema = z.object({
  items: z.array(executionStepSchema),
});
export type ListExecutionsResponse = z.infer<typeof listExecutionsResponseSchema>;

// No `index`: a caller states the order by the array's own order, and the
// server renumbers contiguously from it — never by echoing indices back,
// which is what would let a gap or a duplicate slip in unnoticed.
export const replaceExecutionsRequestSchema = z.array(
  z.object({
    authenticator: z.string().min(1),
    requirement: executionRequirementSchema,
  }),
);
export type ReplaceExecutionsRequest = z.infer<typeof replaceExecutionsRequestSchema>;

export const replaceExecutionsResponseSchema = listExecutionsResponseSchema;
export type ReplaceExecutionsResponse = ListExecutionsResponse;
