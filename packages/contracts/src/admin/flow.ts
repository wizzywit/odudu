import { z } from 'zod';
import { noBidiControls, noNul } from '#/bidi';
import { characterCount } from '#/admin/profile';
import { idSchema } from '#/admin/shared';

// The `requirement` of a flow step (`REQUIREMENTS` in
// packages/authn-flows/src/schema/flow.ts): the same four values, restated
// here as the one wire vocabulary a request or response carries.
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

// `available` is every authenticator a step may name, from the same registry
// a login dispatches through — so adding a step needs no list of its own.
export const listExecutionsResponseSchema = z.object({
  items: z.array(executionStepSchema),
  available: z.array(z.string()),
});
export type ListExecutionsResponse = z.infer<typeof listExecutionsResponseSchema>;

// No `index`: a caller states the order by the array's own order, and the
// server renumbers contiguously from it — never by echoing indices back,
// which is what would let a gap or a duplicate slip in unnoticed.
export const FLOW_STEP_MAX = 20;
export const FLOW_NAME_MAX = 64;
export const FLOW_LIMIT = 20;

export const replaceExecutionsRequestSchema = z
  .array(
    z.object({
      authenticator: z.string().min(1),
      requirement: executionRequirementSchema,
    }),
  )
  .max(FLOW_STEP_MAX);
export type ReplaceExecutionsRequest = z.infer<typeof replaceExecutionsRequestSchema>;

export const replaceExecutionsResponseSchema = listExecutionsResponseSchema;
export type ReplaceExecutionsResponse = ListExecutionsResponse;

// A step of a named flow carries no index: its place is its place in the array.
export const flowStepSchema = z.strictObject({
  authenticator: z.string().min(1).max(64),
  requirement: executionRequirementSchema,
});
export type FlowStepWire = z.infer<typeof flowStepSchema>;

export const flowSchema = z.object({
  id: idSchema,
  name: z.string(),
  is_default: z.boolean(),
  steps: z.array(flowStepSchema),
});
export type FlowWire = z.infer<typeof flowSchema>;

// A tenant holds at most FLOW_LIMIT flows, so the list is never paged and
// `total` is every flow the tenant has.
export const listFlowsResponseSchema = z.object({
  items: z.array(flowSchema),
  total: z.number().int().nonnegative(),
  available: z.array(z.string()),
});
export type ListFlowsResponse = z.infer<typeof listFlowsResponseSchema>;

// The length is counted in code points, as the table's CHECK counts it.
const flowNameSchema = noNul(noBidiControls(z.string().trim().min(1))).refine(
  (name) => characterCount(name) <= FLOW_NAME_MAX,
  { error: `name must be at most ${String(FLOW_NAME_MAX)} characters` },
);

// Create and replace take the same body: a flow is always written whole.
// `is_default` is not accepted: making another flow the default is its own act.
export const saveFlowRequestSchema = z.strictObject({
  name: flowNameSchema,
  steps: z.array(flowStepSchema).max(FLOW_STEP_MAX),
});
export type SaveFlowRequest = z.infer<typeof saveFlowRequestSchema>;
