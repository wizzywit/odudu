import type { ModelMessage } from 'ai';
import { inputUpperBound } from '#/service/estimate';

const OMITTED = '[an earlier tool result was left out to fit the context]';
const CUT = '\n[this tool result was cut to fit the context]';

// The same bound a reservation uses for messages, so what is kept here is
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

function resultText(output: { type: string; value?: unknown }): string {
  return typeof output.value === 'string' ? output.value : JSON.stringify(output.value ?? null);
}

// Replaces the longest result of a tool message with a shorter prefix of it,
// by `excess` characters and the note, or returns undefined when none is left to cut.
function cutLongest(message: ModelMessage, excess: number): ModelMessage | undefined {
  if (message.role !== 'tool') return undefined;
  let longest = -1;
  let longestLength = 0;
  message.content.forEach((part, index) => {
    if (part.type !== 'tool-result') return;
    const length = resultText(part.output).length;
    if (length > longestLength) {
      longest = index;
      longestLength = length;
    }
  });
  if (longest === -1 || longestLength <= CUT.length) return undefined;
  const keep = Math.max(0, longestLength - excess - CUT.length);
  return {
    role: 'tool',
    content: message.content.map((part, index) =>
      part.type === 'tool-result' && index === longest
        ? {
            ...part,
            output: {
              type: 'text' as const,
              value: `${resultText(part.output).slice(0, keep)}${CUT}`,
            },
          }
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

// The last person message cut to the longest prefix that still fits, with
// every message after it kept.
function shortened(kept: ModelMessage[], at: number, max: number): ModelMessage[] {
  const text = textOf(kept[at] ?? { role: 'user', content: '' });
  const build = (length: number): ModelMessage[] =>
    kept.with(at, { role: 'user', content: text.slice(0, length) });
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (sizeOf(build(middle)) <= max) low = middle;
    else high = middle - 1;
  }
  return build(low);
}

/**
 * Brings a conversation's messages under `maxTokens`, counted as the budget
 * counts: one token per byte. System messages and the last person message are
 * kept. The oldest turns go first, then the output of earlier tool calls, then
 * the newest tool result is cut to a prefix that fits and says so, so the model
 * still sees what it just asked for. Only then is the last person message itself
 * cut short. A call in flight is never dropped.
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
  const newest = kept.findLastIndex((message) => message.role === 'tool');
  for (let index = 0; index < newest && sizeOf(kept) > maxTokens; index += 1) {
    const message = kept[index];
    if (message !== undefined) kept = kept.with(index, withoutResults(message));
  }
  for (let guard = 0; guard < 8 && newest !== -1 && sizeOf(kept) > maxTokens; guard += 1) {
    const message = kept[newest];
    const cut = message === undefined ? undefined : cutLongest(message, sizeOf(kept) - maxTokens);
    if (cut === undefined) break;
    kept = kept.with(newest, cut);
  }
  if (sizeOf(kept) <= maxTokens) return kept;

  const lastUser = kept.findLastIndex((message) => message.role === 'user');
  return lastUser === -1 ? kept : shortened(kept, lastUser, maxTokens);
}
