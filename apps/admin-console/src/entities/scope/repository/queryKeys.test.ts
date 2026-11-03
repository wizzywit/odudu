import { expect, it } from 'vitest';
import { scopeClientsKey } from '#/entities/scope/repository/queryKeys';

it('names the clients of a scope by the tenant and the scope', () => {
  expect(scopeClientsKey('acme', 'sc1')).toEqual(['scope-clients', 'acme', 'sc1']);
  expect(scopeClientsKey('acme')).toEqual(['scope-clients', 'acme']);
});
