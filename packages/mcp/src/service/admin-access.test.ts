import { describe, expect, it } from 'vitest';
import { accessOf, scopeFor } from '#/service/admin-access';
import { ToolProblem } from '#/service/tool';
import { tokenOf } from '#/testing/token';

describe('the access an admin call needs', () => {
  it('is read for a GET and write for anything else', () => {
    expect(accessOf('GET')).toBe('read');
    expect(accessOf('PATCH')).toBe('write');
  });

  it('narrows to the one scope the call needs', () => {
    const token = tokenOf({ scope: ['mcp:read', 'mcp:write'] });
    expect(scopeFor(token, 'read')).toEqual(['mcp:read']);
    expect(scopeFor(token, 'write')).toEqual(['mcp:write']);
  });

  it('is refused when the presented token lacks the scope', () => {
    const token = tokenOf({ scope: ['mcp:read'] });
    expect(() => scopeFor(token, 'write')).toThrow(ToolProblem);
    expect(() => scopeFor(tokenOf({ scope: ['mcp:write'] }), 'read')).toThrow(ToolProblem);
  });
});
