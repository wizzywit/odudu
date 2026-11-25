import type { JsonValue, RegisteredTool, ToolResult } from '@odudu/mcp';
import { tool, type ToolSet } from 'ai';

export const FENCE_OPEN = '<tool-data>';
export const FENCE_CLOSE = '</tool-data>';

// A `<` inside the payload is written as a JSON escape, so the text between
// the fences still parses and no value can spell either fence marker.
const ANGLE = /</gu;

/**
 * What a tool returned, as the model reads it: inside a fence its rules say
 * holds data and never instructions. Both the answer and a refusal come back
 * under their own key (`data`, `error`), as the MCP tools label them.
 */
export function fenceToolOutput(output: JsonValue): string {
  return `${FENCE_OPEN}${JSON.stringify(output).replace(ANGLE, '\\u003c')}${FENCE_CLOSE}`;
}

export type CallTool = (name: string, input: unknown) => Promise<ToolResult>;

/**
 * The given tools as an AI SDK tool set. Each tool's own schema validates the
 * model's arguments before `execute` runs, so a malformed call reaches the
 * model as a refusal and never reaches `call`.
 */
export function toSdkTools(tools: readonly RegisteredTool[], call: CallTool): ToolSet {
  const set: ToolSet = {};
  for (const entry of tools) {
    set[entry.name] = tool({
      description: entry.description,
      inputSchema: entry.input,
      execute: async (input: unknown) => {
        const result = await call(entry.name, input);
        return fenceToolOutput(result.structuredContent as JsonValue);
      },
    });
  }
  return set;
}
