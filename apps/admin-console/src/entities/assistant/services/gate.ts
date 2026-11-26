import type { AssistantMode, AssistantStatus } from '#/entities/assistant/types/assistant';
import { holds } from '#/shared/lib/services/access';
import type { Authority } from '#/shared/lib/services/principal';

// Whether anything about the assistant may be asked or drawn: the deployment
// has one and the caller may use it. Whoami answers both, so a deployment
// without an assistant is never sent a request it would answer as a path it
// never served, and nobody is sent one that can only be refused. While whoami
// is out, or failed, there is no authority and so no assistant.
export function mayUseAssistant(authority: Authority | undefined): boolean {
  return authority?.assistantAvailable === true && holds(authority, 'use-assistant');
}

export interface AssistantView {
  enabled: boolean;
  slots?: { fast: string; standard: string; deep: string };
  modes?: readonly AssistantMode[];
  defaultMode?: AssistantMode;
  modelChoices?: readonly string[];
  provider?: { kind: string; host?: string | undefined };
}

const OFF: AssistantView = { enabled: false };

// What the status read says once the gate is open. A read still out or
// failed is the same as an assistant that is off: nothing is drawn.
export function assistantView(
  available: boolean,
  status: AssistantStatus | undefined,
): AssistantView {
  if (!available || status?.enabled !== true) return OFF;
  return {
    enabled: true,
    slots: status.slots,
    modes: status.modes,
    defaultMode: status.defaultMode,
    modelChoices: status.modelChoices,
    provider: status.provider,
  };
}
