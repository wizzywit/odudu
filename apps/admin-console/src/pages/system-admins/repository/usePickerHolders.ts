import { reportDefect } from '#/shared/lib/platform/report';
import { useQuery } from '@tanstack/react-query';
import {
  HOLDERS_PAST_PAGES_DEFECT,
  holderSet,
  holdersParams,
} from '#/pages/system-admins/services/picker';
import { listKey } from '#/shared/lib/repository/queryKeys';
import { SYSTEM_TENANT } from '#/shared/lib/services/principal';
import { useTransport } from '#/shared/api/transport/useTransport';
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
      reportDefect(HOLDERS_PAST_PAGES_DEFECT);
      return ids;
    },
  });
  return holderSet(holders.data);
}
