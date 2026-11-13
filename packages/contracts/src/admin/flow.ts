import { z } from 'zod';
import { noBidiControls, noNul } from '#/bidi';
import { characterCount } from '#/admin/profile';
import { idSchema } from '#/admin/shared';
import {
  RECOVERY_CODE_COUNT_RANGE,
  TOTP_ALGORITHM_CHOICES,
  TOTP_DIGITS_CHOICES,
  TOTP_PERIOD_CHOICES,
  WEBAUTHN_REQUIREMENT_CHOICES,
} from '#/admin/settings';

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

// What a step may override of the tenant's authenticator settings, by the
// same choices and range the tenant's own settings take. At most six keys,
// and a key absent means the tenant's value.
export const flowStepSettingsSchema = z.strictObject({
  algorithm: z.enum(TOTP_ALGORITHM_CHOICES).optional(),
  digits: z.literal(TOTP_DIGITS_CHOICES).optional(),
  period: z.literal(TOTP_PERIOD_CHOICES).optional(),
  user_verification: z.enum(WEBAUTHN_REQUIREMENT_CHOICES).optional(),
  resident_key: z.enum(WEBAUTHN_REQUIREMENT_CHOICES).optional(),
  count: z
    .number()
    .int()
    .min(RECOVERY_CODE_COUNT_RANGE.min)
    .max(RECOVERY_CODE_COUNT_RANGE.max)
    .optional(),
});
export type FlowStepSettings = z.infer<typeof flowStepSettingsSchema>;

// The settings keys each authenticator reads. An authenticator not listed
// takes none.
const FLOW_STEP_SETTING_KEYS: Readonly<Record<string, readonly (keyof FlowStepSettings)[]>> = {
  otp: ['algorithm', 'digits', 'period'],
  passkey: ['user_verification', 'resident_key'],
  'recovery-code': ['count'],
};

// The keys an authenticator reads; none for a name the table does not list,
// whatever an object inherits under that name.
export function settingKeysOf(authenticator: string): readonly (keyof FlowStepSettings)[] {
  return Object.hasOwn(FLOW_STEP_SETTING_KEYS, authenticator)
    ? (FLOW_STEP_SETTING_KEYS[authenticator] ?? [])
    : [];
}

export const executionStepSchema = z.object({
  index: z.number().int().nonnegative(),
  authenticator: z.string(),
  requirement: executionRequirementSchema,
  settings: flowStepSettingsSchema.optional(),
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
      settings: flowStepSettingsSchema.optional(),
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
  settings: flowStepSettingsSchema.optional(),
});
export type FlowStepWire = z.infer<typeof flowStepSchema>;

export const flowSchema = z.object({
  id: idSchema,
  name: z.string(),
  is_default: z.boolean(),
  steps: z.array(flowStepSchema),
});
export type FlowWire = z.infer<typeof flowSchema>;

// A list row also says how many clients name the flow; a single read does not,
// so the count stays out of the flow's `ETag`.
export const flowListItemSchema = flowSchema.extend({
  client_count: z.number().int().nonnegative(),
});
export type FlowListItemWire = z.infer<typeof flowListItemSchema>;

// A tenant holds at most FLOW_LIMIT flows, so the list is never paged and
// `total` is every flow the tenant has.
export const listFlowsResponseSchema = z.object({
  items: z.array(flowListItemSchema),
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
