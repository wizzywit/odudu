import { useQuery } from '@tanstack/react-query';
import { readAdministratorPage } from '#/shared/adapter/administrators.ts';
import { MANAGE_TENANTS } from '#/shared/service/administrators.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';
import { ADMINISTRATORS } from '#/features/system-admins/repository/useSystemAdministrators.ts';

// The holders among what the picker's search matches, read once per search
// whatever the list beside it is narrowed to. Under the list's key, so a
// grant or revoke reads it again.
export function usePickerHolders(query: string): ReadonlySet<string> | null {
  const { gateway } = useTransport();
  const holders = useQuery({
    queryKey: ['list', SYSTEM_TENANT, ADMINISTRATORS, 'picker holders', query],
    queryFn: async () => {
      const params = new URLSearchParams({ capability: MANAGE_TENANTS });
      if (query !== '') params.set('username', query);
      const result = await readAdministratorPage(gateway, SYSTEM_TENANT, params);
      return result.ok ? result.data.items.map((subject) => subject.id) : null;
    },
  });
  return holders.data === undefined || holders.data === null ? null : new Set(holders.data);
}
