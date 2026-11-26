import type { RegisteredTool } from '@odudu/mcp';
import type { ConversationMode } from '#/repository/conversations';
import { writeToolNames } from '#/service/approval-card';

export type ApprovalVerdict = 'auto' | 'deny' | 'ask';

// What the model reads when it asks for a change in Ask mode.
export const ASK_MODE_DENIAL =
  'This conversation is in Ask mode, so nothing was changed. If the person wants this done, ' +
  'tell them to switch the conversation to Act mode and ask again.';

/**
 * Whether a tool call runs by itself, is refused, or waits for the person.
 * Reads run in either mode. A write waits in Act mode and is refused in Ask
 * mode; one that is not among the twelve the assistant may propose is refused
 * whatever the mode, though it is never offered to the model.
 */
export function approvalPolicy(input: {
  readonly mode: ConversationMode;
  readonly annotations: RegisteredTool['annotations'];
  readonly tool: string;
}): ApprovalVerdict {
  if (input.annotations.readOnlyHint) return 'auto';
  if (!writeToolNames().has(input.tool)) return 'deny';
  return input.mode === 'act' ? 'ask' : 'deny';
}
