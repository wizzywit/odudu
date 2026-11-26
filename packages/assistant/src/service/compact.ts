import type { ModelMessage } from 'ai';
import { inputUpperBound } from '#/service/estimate';

const OMITTED = '[an earlier tool result was left out to fit the context]';

// The same bound a reservation uses for a request, so what is kept here is
// what the budget was told it would be.
function sizeOf(messages: readonly ModelMessage[]): number {
  return inputUpperBound(JSON.stringify(messages));
}

// Groups start at a person's message, so a tool call is never kept without
// its result and a reply never without the question it answers. Anything
// before the first person message has no question and is left out.
function turnsOf(messages: readonly ModelMessage[]): ModelMessage[][] {
  const turns: ModelMessage[][] = [];
  for (const message of messages) {
    if (message.role === 'user') turns.push([message]);
    else turns.at(-1)?.push(message);
  }
  return turns;
}

function withoutResults(message: ModelMessage): ModelMessage {
  if (message.role !== 'tool') return message;
  return {
    role: 'tool',
    content: message.content.map((part) =>
      part.type === 'tool-result'
        ? { ...part, output: { type: 'text' as const, value: OMITTED } }
        : part,
    ),
  };
}

function textOf(message: ModelMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter((text) => text !== '')
    .join('\n');
}

// The longest prefix of the text that, as the last message, still fits.
function shortened(before: ModelMessage[], last: ModelMessage, max: number): ModelMessage[] {
  const text = textOf(last);
  const fits = (length: number): boolean =>
    sizeOf([...before, { role: 'user', content: text.slice(0, length) }]) <= max;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return [...before, { role: 'user', content: text.slice(0, low) }];
}

/**
 * Brings a conversation's messages under `maxTokens`, counted as the budget
 * counts: one token per byte. System messages and the last person message are
 * kept. The oldest turns go first, then the output of earlier tool calls, and
 * only then is the last message itself cut short.
 */
export function compactHistory(
  messages: readonly ModelMessage[],
  maxTokens: number,
): ModelMessage[] {
  if (sizeOf(messages) <= maxTokens) return [...messages];
  const system = messages.filter((message) => message.role === 'system');
  const turns = turnsOf(messages.filter((message) => message.role !== 'system'));
  while (turns.length > 1 && sizeOf([...system, ...turns.flat()]) > maxTokens) turns.shift();

  let kept = [...system, ...turns.flat()];
  for (let index = 0; index < kept.length && sizeOf(kept) > maxTokens; index += 1) {
    const message = kept[index];
    if (message !== undefined) kept = kept.with(index, withoutResults(message));
  }
  if (sizeOf(kept) <= maxTokens) return kept;

  const lastUser = kept.findLastIndex((message) => message.role === 'user');
  const last = kept[lastUser];
  if (last === undefined) return kept;
  return shortened(kept.slice(0, lastUser), last, maxTokens);
}
