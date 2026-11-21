export interface McpLogger {
  debug(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}
