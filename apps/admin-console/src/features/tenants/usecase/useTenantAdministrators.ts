import type { Subject } from '@odudu/contracts/admin';
import { useAuthority, usePrincipal } from '#/features/session/index.ts';
import { holds } from '#/features/shell/index.ts';
import { useAdministrators } from '#/features/tenants/repository/useAdministrators.ts';
import { beginAdministrator } from '#/features/tenants/repository/useCreation.ts';
import { useGo } from '#/features/tenants/repository/useGo.ts';
import { ADMINISTRATOR_NEEDS, NEW_TENANT_HREF } from '#/features/tenants/service.ts';
import { SYSTEM_TENANT, type AdminCapability } from '#/shared/service/principal.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

export interface TenantAdministrators {
  readonly list: ResourceListState<Subject>;
  // What adding one needs that whoami says is missing, named instead of refused.
  readonly addNeeds: readonly AdminCapability[];
  readonly add: () => void;
}

export function useTenantAdministrators(tenant: string): TenantAdministrators {
  const principal = usePrincipal();
  const list = useAdministrators(tenant);
  const go = useGo();
  const authority = useAuthority(SYSTEM_TENANT);
  const addNeeds =
    authority === undefined ? [] : ADMINISTRATOR_NEEDS.filter((c) => !holds(authority, c));
  return {
    list,
    addNeeds,
    add: () => {
      if (addNeeds.length > 0) return;
      beginAdministrator(`${principal.tenant}/${principal.subjectId}`, tenant, 'existing');
      go(NEW_TENANT_HREF);
    },
  };
}
