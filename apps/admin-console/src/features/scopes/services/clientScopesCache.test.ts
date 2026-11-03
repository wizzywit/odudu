import { expect, it } from 'vitest';
import { withoutScope, withScopes } from '#/features/scopes/services/clientScopesCache';

it('rebases a cached client on what an assignment answered', () => {
  interface Held {
    id: string;
    name: string;
    assignment: 'default' | 'optional';
  }
  const client = { id: 'c1', scopes: [{ id: 's1', name: 'a', assignment: 'default' } as Held] };
  const answered: Held[] = [{ id: 's2', name: 'b', assignment: 'optional' }];
  expect(withScopes(client, answered)).toEqual({ id: 'c1', scopes: answered });
  expect(withoutScope(client, 's1')).toEqual({ id: 'c1', scopes: [] });
  expect(withoutScope(client, 'nope')).toEqual(client);
});
