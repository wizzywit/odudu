import type { Subject } from '@odudu/contracts/admin';
import { usePrincipal } from '#/features/session/index.ts';
import { useAdministrators } from '#/features/tenants/repository/useAdministrators.ts';
import { beginAdministrator } from '#/features/tenants/repository/useCreation.ts';
import { useGo } from '#/features/tenants/repository/useGo.ts';
import { NEW_TENANT_HREF } from '#/features/tenants/service.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';

export interface TenantAdministrators {
  readonly list: ResourceListState<Subject>;
  readonly add: () => void;
}

export function useTenantAdministrators(tenant: string): TenantAdministrators {
  const principal = usePrincipal();
  const list = useAdministrators(tenant);
  const go = useGo();
  return {
    list,
    add: () => {
      beginAdministrator(`${principal.tenant}/${principal.subjectId}`, tenant, 'existing');
      go(NEW_TENANT_HREF);
    },
  };
}
