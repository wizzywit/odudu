import type { AssistantSettings } from '@odudu/contracts/admin';
import type { AssistantLimits } from '#/service/limits';

/**
 * What a tenant may use of the assistant. The open implementation reads the
 * tenant's settings; a paid layer replaces it and the open product never
 * depends on that one.
 */
export interface Entitlements {
  limits(tenant: string): Promise<AssistantLimits>;
}

/** The open limits: what a tenant chose, with every mode and tool class the product has. */
export function limitsFromSettings(settings: AssistantSettings): AssistantLimits {
  return {
    monthlyTokensBySlot: {
      fast: settings.assistant_monthly_tokens_fast,
      standard: settings.assistant_monthly_tokens_standard,
      deep: settings.assistant_monthly_tokens_deep,
    },
    allowedModels: [],
    toolClasses: ['read', 'write'],
    modes: ['ask', 'act'],
    maxConcurrent: settings.assistant_max_concurrent,
    maxStepsPerTurn: settings.assistant_max_steps_per_turn,
  };
}
