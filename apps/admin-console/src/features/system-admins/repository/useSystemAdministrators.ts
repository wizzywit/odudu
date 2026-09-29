import type { CountResponse, Subject } from '@odudu/contracts/admin';
import { useQuery } from '@tanstack/react-query';
import { readAdministratorCount, readAdministratorPage } from '#/shared/adapter/administrators.ts';
import { useResourceList } from '#/shared/repository/useResourceList.ts';
import { MANAGE_TENANTS } from '#/shared/service/administrators.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

// Named as system's Administrators tab names the same list, so a change
// made here is seen there too.
export const ADMINISTRATORS = 'administrators';

// Everybody in system holding manage-tenants, effectively: directly, through
// a group, or nested under another role.
export function useSystemAdministrators(): ResourceListState<Subject> {
  return useResourceList({
    tenant: SYSTEM_TENANT,
    resource: ADMINISTRATORS,
    search: ['username'],
    filters: ['enabled'],
    fixed: { capability: MANAGE_TENANTS },
    read: (gateway, query) => readAdministratorPage(gateway, SYSTEM_TENANT, query),
    count: (gateway, query) => readAdministratorCount(gateway, SYSTEM_TENANT, query),
  });
}

// What the last-administrator guard counts, whatever the list is narrowed to.
export function useEnabledHolders(): CountResponse | null {
  const { gateway } = useTransport();
  const query = useQuery({
    queryKey: ['count', SYSTEM_TENANT, ADMINISTRATORS, 'enabled holders'],
    queryFn: () =>
      readAdministratorCount(
        gateway,
        SYSTEM_TENANT,
        new URLSearchParams({ capability: MANAGE_TENANTS, enabled: 'true' }),
      ),
  });
  return query.data?.ok === true ? query.data.data : null;
}
