import type { RegisteredTool, ToolResult } from '@odudu/mcp';
import { tool, type ToolSet } from 'ai';
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
    `${text.slice(0, TOOL_OUTPUT_LIMIT)}\n[output cut at ${String(TOOL_OUTPUT_LIMIT)} characters]`,
  );
}

export type CallTool = (name: string, input: unknown, signal?: AbortSignal) => Promise<ToolResult>;

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
): ToolSet {
  const set: ToolSet = {};
  for (const entry of tools) {
    set[entry.name] = tool({
      description: entry.description,
      inputSchema: entry.input,
      execute: async (input: unknown, options) => {
        const signal = options.abortSignal;
        try {
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
