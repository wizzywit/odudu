// A refusal a person running `odudu mcp` can act on. The message is one line,
// names what to change, and never carries a token, a key or a response body.
export class StdioError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'StdioError';
    this.code = code;
  }
}
