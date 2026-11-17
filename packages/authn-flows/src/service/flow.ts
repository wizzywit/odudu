import { z } from 'zod';
import { flowStepSettingsSchema, settingKeysOf } from '@odudu/contracts/admin';
import { type Flow, REQUIREMENTS } from '#/schema/flow';

export const MAX_FLOW_STEPS = 20;
export const MAX_FLOWS_PER_TENANT = 20;
export const MAX_FLOW_NAME_LENGTH = 64;
export const DEFAULT_FLOW_NAME = 'default';

// Whether `settings` names only keys the step's authenticator reads. An
// authenticator that reads none takes no `settings` at all, an empty one included.
export function settingsFitAuthenticator(step: {
  authenticator: string;
  settings?: object | undefined;
}): boolean {
  if (step.settings === undefined) return true;
  const allowed: readonly string[] = settingKeysOf(step.authenticator);
  if (allowed.length === 0) return false;
  return Object.keys(step.settings).every((key) => allowed.includes(key));
}

export const flowStepSchema = z
  .strictObject({
    authenticator: z.string().min(1).max(64),
    requirement: z.enum(REQUIREMENTS),
    settings: flowStepSettingsSchema.optional(),
  })
  .refine(settingsFitAuthenticator, {
    message: 'a step carries settings its authenticator does not read',
  });

export const flowStepsSchema = z.array(flowStepSchema).max(MAX_FLOW_STEPS);

/** The same list, with each authenticator named by the registry a sign-in dispatches through. */
export function registeredFlowStepsSchema(registered: readonly string[]) {
  return flowStepsSchema.refine(
    (steps) => steps.every((step) => registered.includes(step.authenticator)),
    { message: 'a step names an authenticator the registry does not know' },
  );
}

export type ResolvedFlow =
  { kind: 'ok'; flow: Flow } | { kind: 'unknown_flow'; flowId: string } | { kind: 'no_default' };

/**
 * The flow a sign-in runs: the tenant's default when the client names none,
 * otherwise the one it names. A name that matches nothing is a refusal, never
 * the default: a client pinned to a flow that is gone must not sign people in
 * through another.
 */
export function resolveFlow(
  tenantFlows: readonly Flow[],
  clientOverride: string | null,
): ResolvedFlow {
  if (clientOverride !== null) {
    const named = tenantFlows.find((candidate) => candidate.id === clientOverride);
    return named === undefined
      ? { kind: 'unknown_flow', flowId: clientOverride }
      : { kind: 'ok', flow: named };
  }
  const fallback = tenantFlows.find((candidate) => candidate.isDefault);
  return fallback === undefined ? { kind: 'no_default' } : { kind: 'ok', flow: fallback };
}
