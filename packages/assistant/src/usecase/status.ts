import {
  ASSISTANT_SETTING_DEFAULTS,
  type AssistantMode,
  type AssistantSettings,
  type AssistantStatus,
} from '@odudu/contracts/admin';
import {
  COMPATIBLE_BASE_URL_VARIABLE,
  type AssistantEnv,
  type ResolvedSlots,
} from '#/service/slots';

export interface StatusDeps {
  readonly slots: ResolvedSlots | null;
  readonly env: AssistantEnv;
}

// Ask is the mode a person starts in; Act is offered beside it.
const MODES: readonly AssistantMode[] = ['ask', 'act'];

function hostOf(value: string | undefined): string | undefined {
  try {
    return new URL((value ?? '').trim()).host;
  } catch {
    return undefined;
  }
}

/**
 * What the console needs to decide whether to show the assistant and what to
 * offer in it. Names a model and, for a self-hosted endpoint, its host: never
 * a key, a path or any credential in the address. A tenant that switched the
 * assistant off is told it is off, however the deployment is configured.
 */
export function status(
  deps: StatusDeps,
  settings: AssistantSettings = ASSISTANT_SETTING_DEFAULTS,
): AssistantStatus {
  const { slots } = deps;
  if (slots === null || !settings.assistant_enabled) return { enabled: false };
  const named = {
    fast: slots.fast.model,
    standard: slots.standard.model,
    deep: slots.deep.model,
  };
  const kind = slots.standard.provider;
  const host =
    kind === 'openai-compatible' ? hostOf(deps.env[COMPATIBLE_BASE_URL_VARIABLE]) : undefined;
  return {
    enabled: true,
    slots: named,
    modes: [...MODES],
    defaultMode: settings.assistant_default_mode,
    modelChoices: [...new Set([named.fast, named.standard, named.deep])],
    provider: host === undefined ? { kind } : { kind, host },
  };
}
