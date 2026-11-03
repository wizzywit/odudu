import { useQuery } from '@tanstack/react-query';
import { holderSet, holdersParams } from '#/features/system-admins/services/picker';
import { listKey } from '#/shared/repository/queryKeys';
import { SYSTEM_TENANT } from '#/shared/services/principal';
import { useTransport } from '#/shared/transport/useTransport';
import { readSubjectPage } from '#/entities/subject';

// System administrators are few; more pages of them than this is a fault
// somewhere else, said rather than followed without end.
const MOST_PAGES = 10;

// The holders of any admin capability among what the picker's search
// matches, read once per search. Under the list's key, so a change to what
// anybody holds reads it again.
export function usePickerHolders(query: string): ReadonlySet<string> | null {
  const { gateway } = useTransport();
  const holders = useQuery({
    queryKey: listKey(SYSTEM_TENANT, 'picker holders', query),
    queryFn: async () => {
      const ids: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MOST_PAGES; page += 1) {
        const result = await readSubjectPage(gateway, SYSTEM_TENANT, holdersParams(query, cursor));
        if (!result.ok) return null;
        ids.push(...result.data.items.map((subject) => subject.id));
        cursor = result.data.next;
        if (cursor === undefined) return ids;
      }
      console.error(
        `console defect: system's administrators run past ten pages; only those are marked`,
      );
      return ids;
    },
  });
  return holderSet(holders.data);
}
