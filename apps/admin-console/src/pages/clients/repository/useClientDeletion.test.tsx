import { useClientDeletion } from '#/pages/clients/repository/useClientRecord';
import { deletionContract } from '#/testing/deletionContract';

deletionContract({
  noun: 'client',
  resource: 'clients',
  useDeletion: useClientDeletion,
  invalidates: [
    ['list', 'acme'],
    ['count', 'acme'],
  ],
  cache: [
    {
      says: "reads again what the client's roles and assignments took with them, and leaves its own record to lapse",
      entries: [
        [['list', 'acme', 'roles'], 'stale'],
        [['picker', 'acme', 'roles'], 'stale'],
        [['scope-clients', 'acme', 's1'], 'stale'],
        [['held-capabilities', 'acme', 'u1'], 'stale'],
        [['holders', 'acme', 'enabled', 'any'], 'stale'],
        [['count', 'acme', 'roles', ''], 'stale'],
        [['record', 'acme', 'roles/r9/composites'], 'stale'],
        [['record', 'acme', 'groups/g1/roles'], 'stale'],
        [['group', 'acme', 'g1'], 'stale'],
        [['record', 'acme', 'clients/x1'], 'untouched'],
        [['list', 'other', 'roles'], 'untouched'],
      ],
    },
  ],
});
