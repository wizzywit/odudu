const MAX_MESSAGE = 200;

// A message with what could be a secret taken out: a query string is cut from
// every address, and a long run of token characters is shortened. What is left
// is enough to say what failed.
function cleaned(message: string): string {
  return message
    .replace(/\s+/gu, ' ')
    .replace(/(https?:\/\/[^\s?#]+)[?#]\S*/gu, '$1')
    .replace(/[A-Za-z0-9_\-.+/=]{40,}/gu, '…')
    .slice(0, MAX_MESSAGE)
    .trim();
}

// One line on standard error for a failure: what happened, the correlation id,
// and the error's own name and cleaned message when there is one. Never an
// object's contents, a header or a request.
export function failureLine(what: string, requestId: string, cause?: unknown): string {
  const head = `odudu mcp: ${what} (${requestId})`;
  if (arguments.length < 3) return head;
  if (!(cause instanceof Error)) return `${head}: non-error value`;
  return `${head}: ${cause.name}: ${cleaned(cause.message)}`;
}
