import { asSchema, type ToolSet } from 'ai';

// The most a model call may answer with. A reservation holds this much on top
// of the request, so the bound is real only because the call is made with it.
export const MAX_OUTPUT_TOKENS = 8192;

// The most a request may be, counted as the budget counts it. Earlier messages
// are compacted to what this leaves after the instructions and the tools.
export const MAX_REQUEST_TOKENS = 150_000;

/** The tool definitions as a provider is sent them, serialised once for a turn. */
export async function toolDefinitionsText(tools: ToolSet): Promise<string> {
  const definitions = await Promise.all(
    Object.entries(tools).map(async ([name, entry]) => ({
      name,
      description: entry.description,
      schema: await asSchema(entry.inputSchema).jsonSchema,
    })),
  );
  return JSON.stringify(definitions);
}

/** The whole request a step sends, serialised, for the input upper bound. */
export function requestText(
  instructions: unknown,
  messages: unknown,
  toolDefinitions: string,
): string {
  return `${JSON.stringify(instructions)}${JSON.stringify(messages)}${toolDefinitions}`;
}
