import { useAuthority } from '#/entities/session';
import { systemAdminsHrefOf } from '#/pages/tenants/services/systemAddress';
import { administratorCapability, administratorNeeds } from '#/shared/services/administrators';
import { lacking, notLacking } from '#/shared/services/access';
import { SYSTEM_TENANT } from '#/shared/services/principal';
import { useBeginAdministrator, type BeginAdministrator } from '#/features/begin-administrator';

export interface TenantAdministrators {
  // The capability or role the guard counts, and for `system` where its
  // administrators are managed.
  counted: 'tenant-admin' | 'manage-tenants';
  systemAdminsHref: string | null;
  begin: BeginAdministrator;
  // Whether whoami says a holder's capabilities may be changed here.
  canChange: boolean;
  // The tenant whose authority decides what the holders list may change.
  authorityTenant: string;
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
    authorityTenant: SYSTEM_TENANT,
    begin: {
      ...begin,
      start: () => {
        if (addNeeds.length === 0) begin.start();
      },
    },
  };
}
