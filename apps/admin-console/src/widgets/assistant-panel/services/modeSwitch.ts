import type { GatewayFailure, GatewayResult } from '#/shared/lib/services/result';
import { PANEL_WORDING, targetDeclinesAct } from '#/widgets/assistant-panel/services/wording';
import type { AssistantMode } from '#/widgets/assistant-panel/types/chat';

// What the server's answer to a mode switch means for the panel: the mode now
// in force, or the sentence that says it did not change.
export function modeAfter(
  result: GatewayResult<{ mode: AssistantMode }>,
  actingIn: string | null,
): {
  mode: AssistantMode | null;
  problem: string | null;
} {
  if (result.ok) return { mode: result.data.mode, problem: null };
  return { mode: null, problem: refusalOf(result, actingIn) };
}

// The sentence the server's refusal to switch to Act in another tenant is
// matched by: that tenant, not the person's own, does not offer it.
export const TARGET_ACT_DETAIL = 'the tenant this conversation acts in does not offer Act';

function refusalOf(result: GatewayFailure, actingIn: string | null): string {
  const declined =
    result.kind === 'problem' &&
    result.problem.status === 409 &&
    result.problem.detail === TARGET_ACT_DETAIL;
  return declined && actingIn !== null ? targetDeclinesAct(actingIn) : PANEL_WORDING.modeFailed;
}

// The mode a switch's value names, or null for a value that is neither.
export function modeOfChoice(value: string): AssistantMode | null {
  return value === 'ask' || value === 'act' ? value : null;
}

// The mode in force: what the person chose here, else the conversation's own.
export function shownMode(chosen: AssistantMode | null, stored: AssistantMode): AssistantMode {
  return chosen ?? stored;
}
