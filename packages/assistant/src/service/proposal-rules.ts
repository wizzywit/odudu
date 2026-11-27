import type { ToolResult } from '@odudu/mcp';
import type { CapRefusal } from '#/service/approval-limits';

// What the model reads when a proposal could not be made. Each is true of the
// proposal alone and tells it what to do next.
export const LIMIT_DENIAL =
  'The person already has as many changes waiting for a decision as are allowed, so this was not proposed. ' +
  'Tell them to decide on the waiting ones or let them expire.';
export const CONVERSATION_CAP_DENIAL =
  'As many changes as may wait at once in this conversation are already waiting, so this was not proposed. ' +
  'Tell the person to decide on them first.';
export const OWNER_CAP_DENIAL =
  'As many changes as may wait at once for this person are already waiting, so this was not proposed. ' +
  'Tell the person to decide on them or let them expire.';
export const UNREADABLE_DENIAL =
  'The current state of what this would change could not be read, so it was not proposed. ' +
  'Say so, and try again only if the person asks.';
export const MISSING_DENIAL =
  'What this would change does not exist, so it was not proposed. Check the id with a read tool.';
export const FAILED_DENIAL = 'This change could not be proposed. Say so, and do not retry it.';
export const HUMAN_ONLY_DENIAL =
  'This change is one the assistant never makes: what it would change gives a person administrator ' +
  'access, is an administrator, is the assistant’s own configuration or is the session this run ' +
  'depends on, so it was not proposed. Say so, and that the person can make it in the console.';

/** Refused because a value would not show whole on the card the person decides on. */
export function oversizeDenial(field: string): string {
  return (
    `The value of ${field} is too long to show the person in full, and a change is never ` +
    'proposed that they cannot read whole, so it was not proposed. Say so, and that they can ' +
    'make this edit themselves in the console.'
  );
}

export function capDenial(reason: CapRefusal | 'limit'): string {
  if (reason === 'conversation_cap') return CONVERSATION_CAP_DENIAL;
  if (reason === 'owner_cap') return OWNER_CAP_DENIAL;
  return LIMIT_DENIAL;
}

interface HistoryMessage {
  readonly role: string;
  readonly content: unknown;
}

/**
 * Whether the call is already in the history the SDK passes: it is then being
 * re-checked after the person's decision, not proposed. The re-check must write
 * nothing, since the approval it would open exists, and the mode is still judged.
 */
export function inHistory(messages: readonly HistoryMessage[], toolCallId: string): boolean {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      Array.isArray(message.content) &&
      message.content.some(
        (part: { type?: unknown; toolCallId?: unknown }) =>
          part.type === 'tool-call' && part.toolCallId === toolCallId,
      ),
  );
}

/**
 * Why a read of the target failed: its absence (404) or anything else. An
 * error that is not a 404 refuses the proposal, since the person is never
 * asked to approve a change the server could not look at.
 */
export function readFailure(result: ToolResult): 'missing' | 'unreadable' | null {
  if (!result.isError) return null;
  const error = result.structuredContent.error as { status?: unknown } | undefined;
  return error?.status === 404 ? 'missing' : 'unreadable';
}

export function asRows(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

/**
 * The denial for what the read showed of the fields the call names, or null to
 * go on: an answer of an unexpected shape is unreadable, and a target that is
 * missing where the call does not create it is refused.
 */
export function beforeDenial(shown: {
  readonly before: unknown;
  readonly hasRead: boolean;
  readonly mayCreate: boolean;
}): string | null {
  if (shown.before === undefined) return UNREADABLE_DENIAL;
  if (shown.before === null && shown.hasRead && !shown.mayCreate) return MISSING_DENIAL;
  return null;
}

/** Whether a conversation may be switched to a mode, given what is offered. */
export function modeOffered(input: {
  readonly mode: 'ask' | 'act';
  readonly canPropose: boolean;
  readonly modes: readonly string[];
}): boolean {
  return input.mode === 'ask' || (input.canPropose && input.modes.includes('act'));
}
