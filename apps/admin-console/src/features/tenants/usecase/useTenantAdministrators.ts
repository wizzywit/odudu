import type { Subject } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session/index.ts';
import { useAdministrators } from '#/features/tenants/repository/useAdministrators.ts';
import { SYSTEM_ADMINS_HREF } from '#/features/tenants/service.ts';
import { administratorCapability, administratorNeeds } from '#/shared/service/administrators.ts';
import { lacking } from '#/shared/service/access.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import {
  useBeginAdministrator,
  type BeginAdministrator,
} from '#/features/tenants/usecase/useBeginAdministrator.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

export interface TenantAdministrators {
  readonly list: ResourceListState<Subject>;
  // The capability or role the guard counts, and for `system` where its
  // administrators are managed.
  readonly counted: 'tenant-admin' | 'manage-tenants';
  readonly systemAdminsHref: string | null;
  readonly begin: BeginAdministrator;
}

export function useTenantAdministrators(tenant: string): TenantAdministrators {
  const list = useAdministrators(tenant);
  const begin = useBeginAdministrator(tenant, 'existing');
  const authority = useAuthority(SYSTEM_TENANT);
  const addNeeds = lacking(
    authority,
    administratorNeeds(tenant, { subjectId: null, granted: false }),
  );
  return {
    list,
    counted: administratorCapability(tenant),
    systemAdminsHref: tenant === SYSTEM_TENANT ? SYSTEM_ADMINS_HREF : null,
    begin: {
      ...begin,
      start: () => {
        if (addNeeds.length === 0) begin.start();
      },
    },
  };
}
