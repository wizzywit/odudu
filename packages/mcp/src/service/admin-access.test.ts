import { describe, expect, it } from 'vitest';
import { accessOf, scopeFor } from '#/service/admin-access';
import { ToolProblem } from '#/service/tool';
import { unverifiedTokenForTests } from '#/testing/token';

describe('the access an admin call needs', () => {
  it('is read for a GET and write for anything else', () => {
    expect(accessOf('GET')).toBe('read');
    expect(accessOf('PATCH')).toBe('write');
  });

  it('narrows to the one scope the call needs', () => {
    const token = unverifiedTokenForTests({ scope: ['mcp:read', 'mcp:write'] });
    expect(scopeFor(token, 'read')).toEqual(['mcp:read']);
    expect(scopeFor(token, 'write')).toEqual(['mcp:write']);
  });

  it('is refused when the presented token lacks the scope', () => {
    const token = unverifiedTokenForTests({ scope: ['mcp:read'] });
    expect(() => scopeFor(token, 'write')).toThrow(ToolProblem);
  });

  it('lets a write-only token read, with the one scope it holds', () => {
    expect(scopeFor(unverifiedTokenForTests({ scope: ['mcp:write'] }), 'read')).toEqual([
      'mcp:write',
    ]);
  });

  it('prefers the narrower read scope when the token holds both', () => {
    expect(scopeFor(unverifiedTokenForTests({ scope: ['mcp:write', 'mcp:read'] }), 'read')).toEqual(
      ['mcp:read'],
    );
  });

  it('never lets a read-only token write, nor a token with no MCP scope do anything', () => {
    expect(() => scopeFor(unverifiedTokenForTests({ scope: ['mcp:read'] }), 'write')).toThrow(
      ToolProblem,
    );
    expect(() => scopeFor(unverifiedTokenForTests({ scope: ['openid'] }), 'read')).toThrow(
      ToolProblem,
    );
    expect(() => scopeFor(unverifiedTokenForTests({ scope: [] }), 'write')).toThrow(ToolProblem);
  });
});
