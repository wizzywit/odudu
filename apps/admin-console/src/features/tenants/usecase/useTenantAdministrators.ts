import { useAuthority } from '#/features/session';
import { systemAdminsHrefOf } from '#/features/tenants/service';
import { administratorCapability, administratorNeeds } from '#/shared/service/administrators.ts';
import { lacking, notLacking } from '#/shared/service/access.ts';
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
    systemAdminsHref: systemAdminsHrefOf(tenant),
    canChange: notLacking(authority, ['manage-users']),
    begin: {
      ...begin,
      start: () => {
        if (addNeeds.length === 0) begin.start();
      },
    },
  };
}
