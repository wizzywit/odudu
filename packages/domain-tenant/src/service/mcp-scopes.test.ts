import { describe, expect, it } from 'vitest';
import { holdsMcpScope, isMcpScope, MCP_SCOPES } from '#/service/mcp-client';

describe('the MCP scopes', () => {
  it('are exactly mcp:read and mcp:write', () => {
    expect([...MCP_SCOPES]).toEqual(['mcp:read', 'mcp:write']);
    expect(isMcpScope('mcp:read')).toBe(true);
    expect(isMcpScope('mcp:write')).toBe(true);
    for (const other of ['openid', 'mcp:admin', 'MCP:READ', 'mcp:read ', '']) {
      expect(isMcpScope(other)).toBe(false);
    }
  });

  it('are held when any one is in the list', () => {
    expect(holdsMcpScope(['openid', 'mcp:write'])).toBe(true);
    expect(holdsMcpScope(['openid', 'offline_access'])).toBe(false);
    expect(holdsMcpScope([])).toBe(false);
  });
});
