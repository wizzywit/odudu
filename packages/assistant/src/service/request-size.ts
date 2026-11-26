import { asSchema, type ToolSet } from 'ai';

// The most a model call may answer with. A reservation holds this much on top
// of the request, so the bound is real only because the call is made with it.
export const MAX_OUTPUT_TOKENS = 8192;

// The most a request may be, counted as the budget counts it. Earlier messages
// are compacted to what this leaves after the instructions and the tools.
export const MAX_REQUEST_TOKENS = 150_000;

// What the fixed part of a request (instructions and tool definitions) measured
// at: about 3 to 4 bytes a token on JSON schema, so 2.5 leaves a margin. The
// messages keep the bound of one token a byte, which no tokenizer exceeds.
export const FIXED_BYTES_PER_TOKEN = 2.5;

export interface ReservationInput {
  readonly fixedBytes: number;
  readonly messagesBytes: number;
  /** What the previous step of the turn reported for its input, and the messages it carried. */
  readonly previous?: { readonly inputTokens: number; readonly messagesBytes: number };
}

/**
 * What a model call is reserved at: the estimate for its request plus the most
 * it may answer with, and never less than the previous step's reported input
 * plus the bytes of the messages added since.
 */
export function reservationTokens(input: ReservationInput): number {
  const estimate =
    Math.ceil(input.fixedBytes / FIXED_BYTES_PER_TOKEN) + input.messagesBytes + MAX_OUTPUT_TOKENS;
  if (input.previous === undefined) return estimate;
  const floor =
    input.previous.inputTokens +
    Math.max(0, input.messagesBytes - input.previous.messagesBytes) +
    MAX_OUTPUT_TOKENS;
  return Math.max(estimate, floor);
}

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

/** A step's request in the two parts the reservation treats differently, each serialised. */
export interface RequestParts {
  readonly fixed: string;
  readonly messages: string;
}

export function requestParts(
  instructions: unknown,
  messages: unknown,
  toolDefinitions: string,
): RequestParts {
  return {
    fixed: `${JSON.stringify(instructions)}${toolDefinitions}`,
    messages: JSON.stringify(messages),
  };
}
