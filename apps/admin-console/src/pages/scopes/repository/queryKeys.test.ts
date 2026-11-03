import { expect, it } from 'vitest';
import { builtinScopesKey, scopeImpactKey } from '#/pages/scopes/repository/queryKeys';

it('names what a scope deletion would take and the built-in scopes a tenant has', () => {
  expect(scopeImpactKey('acme', 'sc1')).toEqual(['scope-impact', 'acme', 'sc1']);
  expect(builtinScopesKey('acme')).toEqual(['builtin-scopes', 'acme']);
});
