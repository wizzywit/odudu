import { counted, groupedNumber } from '#/shared/lib/services/format';
import { NO_TITLE } from '#/pages/assistant-activity/services/activityText';
import type { ActivityConversation, SlotTokens } from '#/pages/assistant-activity/types/activity';

export function titleOf(conversation: ActivityConversation): string {
  return conversation.title === null || conversation.title === '' ? NO_TITLE : conversation.title;
}

export function personOf(conversation: ActivityConversation): string {
  return conversation.personName ?? conversation.person;
}

export function tokenTotal(tokens: SlotTokens): number {
  return tokens.fast + tokens.standard + tokens.deep;
}

// Each model slot's share, for the title of a total that adds them.
export function tokenBreakdown(tokens: SlotTokens): string {
  return `Fast ${groupedNumber(tokens.fast)}, standard ${groupedNumber(tokens.standard)}, deep ${groupedNumber(tokens.deep)}`;
}

export function tokensText(tokens: SlotTokens): string {
  return `${groupedNumber(tokenTotal(tokens))} tokens`;
}

export function answersText(conversation: ActivityConversation): string {
  return `${counted(conversation.turns, 'answer', 'answers')}, ${counted(conversation.steps, 'model call', 'model calls')}`;
}

const TOOLS_SHOWN = 3;

// The first few tools it called, and how many more there were.
export function toolsText(tools: readonly string[]): string {
  if (tools.length === 0) return 'No tool called';
  const first = tools.slice(0, TOOLS_SHOWN).join(', ');
  const rest = tools.length - TOOLS_SHOWN;
  return rest > 0 ? `${first} and ${String(rest)} more` : first;
}

export function changesText(count: number): string {
  return count === 0 ? 'None' : counted(count, 'change', 'changes');
}

export function onlyPersonLabel(name: string): string {
  return `Show only ${name}’s conversations`;
}

export function openLabel(title: string): string {
  return `Replay ${title}`;
}
