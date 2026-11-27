import type { RegisteredTool, ToolResult } from '@odudu/mcp';
import { tool, type ToolSet } from 'ai';
import { cutText } from '#/service/cut';
import { fence, FENCE_CLOSE, FENCE_OPEN } from '#/service/fence';

export { FENCE_CLOSE, FENCE_OPEN };

// The most of one tool's output the model is given; the rest is cut and the cut said.
export const TOOL_OUTPUT_LIMIT = 60_000;

/**
 * What a tool returned, as the model reads it: inside a fence its rules say
 * holds data and never instructions. Both the answer and a refusal come back
 * under their own key (`data`, `error`), as the MCP tools label them.
 */
export function fenceToolOutput(
  output: unknown,
  mask: (text: string) => string = (text) => text,
): string {
  const text = mask(JSON.stringify(output));
  if (text.length <= TOOL_OUTPUT_LIMIT) return fence(text);
  return fence(
    `${cutText(text, TOOL_OUTPUT_LIMIT)}\n[output cut at ${String(TOOL_OUTPUT_LIMIT)} characters]`,
  );
}

// The approval for this call was already spent, so the change may have been
// made, by a call that ended before its result was kept.
const SPENT = {
  error: {
    title: 'The change may already have been made',
    detail:
      'This approval was already used, so the change may already have been made. ' +
      'Read the target to see, and do not propose it again unless it is not there.',
  },
};

export type CallTool = (name: string, input: unknown, signal?: AbortSignal) => Promise<ToolResult>;

/** What running an approved write came to: it ran, or the approval did not cover this call. */
export type WriteOutcome =
  | { kind: 'done'; result: ToolResult }
  | { kind: 'not_approved' }
  // What it would change no longer reads as the card showed it: nothing was changed.
  | { kind: 'moved' }
  // The target came to reach an administrator capability since the person approved.
  | { kind: 'human_only' }
  // The approval was already spent: the change may have been made by another call.
  | { kind: 'spent' };

export type CallWrite = (
  name: string,
  input: unknown,
  context: { readonly toolCallId: string; readonly signal?: AbortSignal | undefined },
) => Promise<WriteOutcome>;

// What the model reads when the approval did not cover the call that ran: it
// was refused, had expired, or named a different change.
const NOT_APPROVED = {
  error: {
    title: 'The change was not made',
    detail:
      'It was not approved, the approval had ended, or it was for a different change. ' +
      'Nothing was changed. Propose it again if the person still wants it.',
  },
};

// What the model reads when the target moved after the person approved.
const MOVED = {
  error: {
    title: 'The change was not made',
    detail:
      'What it would change is no longer as the person saw it when they approved, so nothing ' +
      'was changed. Read the target again and propose the change again if the person still wants it.',
  },
};

// What the model reads when the target became one the assistant never changes.
const HUMAN_ONLY = {
  error: {
    title: 'The change was not made',
    detail:
      'What it would change now reaches an administrator capability, which the assistant never ' +
      'changes, so nothing was changed. Tell the person they can make it in the console.',
  },
};

// What the model is told when a call fails before the tool answers. The
// failure's own text is the composition's and is not passed on.
const FAILED = { error: { title: 'The tool could not be run' } };

/**
 * The given tools as an AI SDK tool set. Each tool's own schema validates the
 * model's arguments before `execute` runs, so a malformed call reaches the
 * model as a refusal and never reaches `call`.
 */
export function toSdkTools(
  tools: readonly RegisteredTool[],
  call: CallTool,
  mask?: (text: string) => string,
  write?: CallWrite,
): ToolSet {
  const set: ToolSet = {};
  for (const entry of tools) {
    set[entry.name] = tool({
      description: entry.description,
      inputSchema: entry.input,
      execute: async (input: unknown, options) => {
        const signal = options.abortSignal;
        try {
          if (entry.access === 'write') {
            if (write === undefined) return fenceToolOutput(NOT_APPROVED);
            const outcome = await write(entry.name, input, {
              toolCallId: options.toolCallId,
              signal,
            });
            return fenceToolOutput(
              outcome.kind === 'done'
                ? outcome.result.structuredContent
                : outcome.kind === 'spent'
                  ? SPENT
                  : outcome.kind === 'moved'
                    ? MOVED
                    : outcome.kind === 'human_only'
                      ? HUMAN_ONLY
                      : NOT_APPROVED,
              mask,
            );
          }
          const result = await call(entry.name, input, signal);
          return fenceToolOutput(result.structuredContent, mask);
        } catch (error) {
          if (signal?.aborted === true) throw error;
          return fenceToolOutput(FAILED);
        }
      },
    });
  }
  return set;
}
