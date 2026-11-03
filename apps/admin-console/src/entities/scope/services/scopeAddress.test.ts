import { expect, it } from 'vitest';
import {
  newScopeHref,
  scopeHref,
  scopesHref,
  scopesTrail,
} from '#/entities/scope/services/scopeAddress';

it('addresses the list, the form and a record under the tenant', () => {
  expect(scopesHref('acme')).toBe('/console/acme/scopes');
  expect(newScopeHref('acme')).toBe('/console/acme/scopes/new');
  expect(scopeHref('acme', 'a b')).toBe('/console/acme/scopes/a%20b');
});

it('trails from the Applications heading, which has no address of its own', () => {
  expect(scopesTrail('acme', 'billing')).toEqual([
    { label: 'Applications' },
    { label: 'Scopes', href: '/console/acme/scopes' },
    { label: 'billing' },
  ]);
});
