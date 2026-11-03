import { useGroupDeletion } from '#/pages/groups/repository/useGroupRecord';
import { deletionContract } from '#/testing/deletionContract';

deletionContract({
  noun: 'group',
  resource: 'groups',
  useDeletion: useGroupDeletion,
  invalidates: [['list', 'acme']],
  cache: [
    {
      says: "leaves the deleted group's own reads to lapse and reads the others' again",
      entries: [
        [['group', 'acme', 'x1'], 'untouched'],
        [['group', 'acme', 'x2'], 'stale'],
      ],
    },
  ],
});
