import { describe, expect, it } from 'vitest';
import { agentMayAccess, mayAccess, requiredScope } from '#/service/access';

describe('requiredScope', () => {
  it('is me:read for a read and me:write for a write', () => {
    expect(requiredScope('read')).toBe('me:read');
    expect(requiredScope('write')).toBe('me:write');
  });
});

describe('mayAccess', () => {
  it('holds a read for me:read', () => {
    expect(mayAccess(['openid', 'me:read'], 'read')).toBe(true);
  });

  it('does not hold a read for me:write alone', () => {
    expect(mayAccess(['me:write'], 'read')).toBe(false);
  });

  it('holds a write for me:write', () => {
    expect(mayAccess(['openid', 'me:read', 'me:write'], 'write')).toBe(true);
  });

  it('does not hold a write for me:read alone', () => {
    expect(mayAccess(['openid', 'me:read'], 'write')).toBe(false);
  });

  it('does not hold for an MCP scope', () => {
    expect(mayAccess(['mcp:read', 'mcp:write'], 'read')).toBe(false);
    expect(mayAccess(['mcp:read', 'mcp:write'], 'write')).toBe(false);
  });
});

describe('agentMayAccess', () => {
  it('lets an agent read and never write', () => {
    expect(agentMayAccess(true, 'read')).toBe(true);
    expect(agentMayAccess(true, 'write')).toBe(false);
  });

  it('lets a person do both', () => {
    expect(agentMayAccess(false, 'read')).toBe(true);
    expect(agentMayAccess(false, 'write')).toBe(true);
  });
});
