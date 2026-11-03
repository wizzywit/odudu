import { useScopeDeletion } from '#/pages/scopes/repository/useScopeRecord';
import { deletionContract } from '#/testing/deletionContract';

deletionContract({
  noun: 'scope',
  resource: 'scopes',
  useDeletion: useScopeDeletion,
  invalidates: [['list', 'acme', 'scopes']],
  cache: [
    {
      says: 'drops what the console holds of the clients the scope leaves, rather than marking it stale',
      entries: [[['record', 'acme', 'clients/c1'], 'removed']],
    },
    {
      says: "leaves the deleted record's own entries to lapse and reads the others' again",
      entries: [
        [['record', 'acme', 'scopes/x1'], 'untouched'],
        [['record', 'acme', 'scopes/x1/sub'], 'untouched'],
        [['record', 'acme', 'scopes/x2'], 'stale'],
      ],
    },
  ],
});
