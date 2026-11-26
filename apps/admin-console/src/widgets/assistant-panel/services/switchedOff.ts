const UNAVAILABLE = '"type":"mcp:assistant_unavailable"';

// Whether a tool in the conversation answered that the assistant has been
// switched off. The tool's answer is JSON text, so a value another tenant's
// data holds has its quotes escaped and cannot spell this key.
export function assistantSwitchedOff(
  messages: readonly { role: string; parts: readonly unknown[] }[],
): boolean {
  return messages.some(
    (message) =>
      message.role === 'assistant' &&
      message.parts.some(
        (part) =>
          typeof part === 'object' &&
          part !== null &&
          'output' in part &&
          typeof part.output === 'string' &&
          part.output.includes(UNAVAILABLE),
      ),
  );
}
