import { useAuthority } from '#/features/session/index.ts';
import { SYSTEM_ADMINS_HREF } from '#/features/tenants/service.ts';
import { administratorCapability, administratorNeeds } from '#/shared/service/administrators.ts';
import { lacking } from '#/shared/service/access.ts';
import { SYSTEM_TENANT } from '#/shared/service/principal.ts';
import {
  useBeginAdministrator,
  type BeginAdministrator,
} from '#/features/tenants/usecase/useBeginAdministrator.ts';

export interface TenantAdministrators {
  // The capability or role the guard counts, and for `system` where its
  // administrators are managed.
  counted: 'tenant-admin' | 'manage-tenants';
  systemAdminsHref: string | null;
  begin: BeginAdministrator;
  // Whether whoami says a holder's capabilities may be changed here.
  canChange: boolean;
}

export function useTenantAdministrators(tenant: string): TenantAdministrators {
  const begin = useBeginAdministrator(tenant, 'existing');
  const authority = useAuthority(SYSTEM_TENANT);
  const addNeeds = lacking(
    authority,
    administratorNeeds(tenant, { subjectId: null, granted: false }),
  );
  return {
    counted: administratorCapability(tenant),
    systemAdminsHref: tenant === SYSTEM_TENANT ? SYSTEM_ADMINS_HREF : null,
    canChange: lacking(authority, ['manage-users']).length === 0,
    begin: {
      ...begin,
      start: () => {
        if (addNeeds.length === 0) begin.start();
      },
    },
  };
}
