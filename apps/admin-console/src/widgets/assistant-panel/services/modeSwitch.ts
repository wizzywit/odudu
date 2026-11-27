import type { GatewayResult } from '#/shared/lib/services/result';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type { AssistantMode } from '#/widgets/assistant-panel/types/chat';

// What the server's answer to a mode switch means for the panel: the mode now
// in force, or the sentence that says it did not change.
export function modeAfter(result: GatewayResult<{ mode: AssistantMode }>): {
  mode: AssistantMode | null;
  problem: string | null;
} {
  if (result.ok) return { mode: result.data.mode, problem: null };
  return { mode: null, problem: PANEL_WORDING.modeFailed };
}

// The mode a switch's value names, or null for a value that is neither.
export function modeOfChoice(value: string): AssistantMode | null {
  return value === 'ask' || value === 'act' ? value : null;
}

// The mode in force: what the person chose here, else the conversation's own,
// and never Act in another tenant, where the assistant only reads.
export function shownMode(
  chosen: AssistantMode | null,
  stored: AssistantMode,
  actingIn: string | null,
): AssistantMode {
  return actingIn === null ? (chosen ?? stored) : 'ask';
}
