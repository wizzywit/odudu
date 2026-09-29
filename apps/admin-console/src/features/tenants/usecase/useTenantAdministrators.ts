import type { Subject } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session/index.ts';
import { holds } from '#/features/shell/index.ts';
import { useAdministrators } from '#/features/tenants/repository/useAdministrators.ts';
import { SYSTEM_ADMINS_HREF } from '#/features/tenants/service.ts';
import { administratorCapability, administratorNeeds } from '#/shared/service/administrators.ts';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/service/principal.ts';
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
  // What adding one needs that whoami says is missing, named instead of refused.
  readonly addNeeds: readonly AdminCapability[];
  readonly begin: BeginAdministrator;
}

export function useTenantAdministrators(tenant: string): TenantAdministrators {
  const list = useAdministrators(tenant);
  const begin = useBeginAdministrator(tenant, 'existing');
  const authority = useAuthority(SYSTEM_TENANT);
  const addNeeds =
    authority === undefined
      ? []
      : administratorNeeds(tenant, { subjectId: null, granted: false }).filter(
          (c) => !holds(authority, c),
        );
  return {
    list,
    counted: administratorCapability(tenant),
    systemAdminsHref: tenant === SYSTEM_TENANT ? SYSTEM_ADMINS_HREF : null,
    addNeeds,
    begin: {
      ...begin,
      start: () => {
        if (addNeeds.length === 0) begin.start();
      },
    },
  };
}
