import { describe, expect, it } from 'vitest';
import { validatedMcpToken } from '#/service/validated-token';

const claims = {
  tenant: { id: 't1', name: 'acme' },
  issuer: 'https://id.example.com/tenants/acme',
  subjectId: 's1',
  clientId: 'c1',
  grantId: 'g1',
  scope: ['mcp:read'],
  expSeconds: 1_793_000_000,
};

describe('validatedMcpToken', () => {
  it('turns exp seconds into an instant in milliseconds', () => {
    const token = validatedMcpToken(claims);
    expect(token.expiresAt).toEqual(new Date(1_793_000_000_000));
    expect(token.expiresAt.getFullYear()).toBeGreaterThan(2025);
  });

  it('refuses an exp that is not a count of seconds', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
      expect(() => validatedMcpToken({ ...claims, expSeconds: bad }), String(bad)).toThrow(
        RangeError,
      );
    }
  });

  it('copies what it is given, so a later change to the claims cannot widen it', () => {
    const scope = ['mcp:read'];
    const token = validatedMcpToken({ ...claims, scope });
    scope.push('mcp:write');
    expect(token.scope).toEqual(['mcp:read']);
  });
});
