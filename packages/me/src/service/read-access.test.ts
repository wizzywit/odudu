import { describe, expect, it } from 'vitest';
import { mayRead } from '#/service/read-access';

describe('mayRead', () => {
  it('holds for me:read', () => {
    expect(mayRead(['openid', 'me:read'])).toBe(true);
  });

  it('does not hold for me:write alone', () => {
    expect(mayRead(['me:write'])).toBe(false);
  });

  it('does not hold for an MCP scope', () => {
    expect(mayRead(['mcp:read'])).toBe(false);
  });
});
