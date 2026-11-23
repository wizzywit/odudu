import { MCP_OPTIONS as SDK_OPTIONS } from '@odudu-io/mcp-stdio/internal';
import { describe, expect, it } from 'vitest';
import { MCP_OPTIONS } from '#/cli/mcp-options';

// `odudu help` reads this table without loading the command, so it is a copy
// of the one the command parses with.
describe('the options of odudu mcp', () => {
  it('are the options the standalone command parses, with the same help text', () => {
    expect(MCP_OPTIONS).toEqual(SDK_OPTIONS);
  });
});
