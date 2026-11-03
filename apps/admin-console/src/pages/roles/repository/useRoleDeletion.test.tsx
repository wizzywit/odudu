import { useRoleDeletion } from '#/pages/roles/repository/useRoleRecord';
import { groupKey } from '#/shared/lib/repository/queryKeys';
import { deletionContract } from '#/testing/deletionContract';

deletionContract({
  noun: 'role',
  resource: 'roles',
  useDeletion: useRoleDeletion,
  invalidates: [['list', 'acme']],
  cache: [
    {
      says: "leaves the deleted role's own group read to lapse and reads the others' again",
      entries: [
        [groupKey('acme', 'x1'), 'untouched'],
        [groupKey('acme', 'x2'), 'stale'],
      ],
    },
    {
      says: "leaves the deleted record's own entries to lapse and reads the others' again",
      entries: [
        [['record', 'acme', 'roles/x1'], 'untouched'],
        [['record', 'acme', 'roles/x1/sub'], 'untouched'],
        [['record', 'acme', 'roles/x2'], 'stale'],
      ],
    },
  ],
});
