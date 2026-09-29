import { useQuery } from '@tanstack/react-query';
import { readAdministratorPage } from '#/shared/adapter/administrators.ts';
import { MANAGE_TENANTS } from '#/shared/service/administrators.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';
import { ADMINISTRATORS } from '#/features/system-admins/repository/useSystemAdministrators.ts';

// System administrators are few; more pages of them than this is a fault
// somewhere else, said rather than followed without end.
const MOST_PAGES = 10;

// The holders among what the picker's search matches, read once per search
// whatever the list beside it is narrowed to. Under the list's key, so a
// grant or revoke reads it again.
export function usePickerHolders(query: string): ReadonlySet<string> | null {
  const { gateway } = useTransport();
  const holders = useQuery({
    queryKey: ['list', SYSTEM_TENANT, ADMINISTRATORS, 'picker holders', query],
    queryFn: async () => {
      const ids: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MOST_PAGES; page += 1) {
        const params = new URLSearchParams({ capability: MANAGE_TENANTS });
        if (query !== '') params.set('username', query);
        if (cursor !== undefined) params.set('cursor', cursor);
        const result = await readAdministratorPage(gateway, SYSTEM_TENANT, params);
        if (!result.ok) return null;
        ids.push(...result.data.items.map((subject) => subject.id));
        cursor = result.data.next;
        if (cursor === undefined) return ids;
      }
      console.error(
        `console defect: system's holders of manage-tenants run past ten pages; only those are marked`,
      );
      return ids;
    },
  });
  return holders.data === undefined || holders.data === null ? null : new Set(holders.data);
}
