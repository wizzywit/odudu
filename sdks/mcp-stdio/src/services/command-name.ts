// The text the package prints names the command as `odudu mcp`, the way the
// server runs it. A caller that runs it under another name (`odudu-mcp`, the
// package's own command) has the name swapped on the way out, so each message
// tells the person to type what they actually ran.
const CANONICAL = 'odudu mcp';

export function nameCommand(line: string, command: string): string {
  return command === CANONICAL ? line : line.replaceAll(CANONICAL, command);
}
