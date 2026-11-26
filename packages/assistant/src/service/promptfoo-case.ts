// A conversation as one promptfoo test case: what the person asked, taken from
// the conversation and masked as the trace is, and what the trace holds of what
// the assistant did. It names what it contains and what it leaves out, and holds
// nothing the trace does not.
import {
  PROMPTFOO_CASE_VERSION,
  type AssistantActivityReplay,
  type AssistantPromptfooCase,
} from '@odudu/contracts/admin';

type Replay = AssistantActivityReplay;

export const CASE_CONTAINS = [
  'the person’s messages, from the conversation, with secrets and, where the tenant masks them, email addresses hidden',
  'each tool the assistant called and the input it gave, as the trace holds it',
  'the answer text of each turn, as the trace holds it',
  'why each turn stopped',
] as const;

export const CASE_CONTAINS_HIDDEN = [
  'the tools the assistant called, by name, and why each turn stopped',
  'a placeholder where the person’s messages, the tool inputs and the answers were: this tenant has not let auditors read the text',
] as const;

export const CASE_EXCLUDES = [
  'the system prompt, of which the trace keeps only a hash',
  'what the tools returned',
  'the model’s reasoning',
  'the provider key and the headers of any request',
] as const;

function stringOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function answerOf(turn: Replay['turns'][number]): string {
  return turn.events
    .filter((event) => event.kind === 'text')
    .map((event) => stringOf(event.payload.text) ?? '')
    .join('');
}

/**
 * `asked` is the person's messages already masked, oldest first. The case has
 * the first as its prompt and all of them as its messages; its assertions are
 * left empty for the person who files it to write.
 */
export function promptfooCaseOf(replay: Replay, asked: readonly string[]): AssistantPromptfooCase {
  const shown = replay.text_visible;
  const { conversation } = replay;
  const toolCalls = replay.turns.flatMap((turn) =>
    turn.events
      .filter((event) => event.kind === 'tool_call')
      .flatMap((event) => {
        const tool = stringOf(event.payload.tool);
        return tool === null ? [] : [{ tool, input: event.payload.input ?? null }];
      }),
  );
  return {
    description: `Odudu assistant ${conversation.profile} conversation ${conversation.id}`,
    vars: {
      profile: conversation.profile,
      mode: conversation.mode,
      prompt: asked[0] ?? '',
      messages: asked.map((content) => ({ role: 'user', content })),
    },
    assert: [],
    metadata: {
      source: 'odudu-assistant-trace',
      version: PROMPTFOO_CASE_VERSION,
      conversation: conversation.id,
      turns: replay.turns.length,
      contains: shown ? [...CASE_CONTAINS] : [...CASE_CONTAINS_HIDDEN],
      excludes: [...CASE_EXCLUDES],
      observed: {
        stop_reasons: replay.turns.map((turn) => turn.stop_reason),
        tool_calls: toolCalls,
        answers: replay.turns.map(answerOf),
      },
    },
  };
}
