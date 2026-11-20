import { processMcpIo, runMcp, type McpIo } from '@odudu-io/mcp-stdio';

export { processMcpIo, type McpIo };

// `odudu mcp` runs the code `npx @odudu-io/mcp-stdio` runs: this file only
// hands it the process's own streams, environment and clock.
export function mcpCommand(argv: readonly string[], io: McpIo): Promise<number> {
  return runMcp(io, argv);
}
