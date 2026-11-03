import type { RegistrationToken } from '@odudu/contracts/admin';
import { readTokenPage } from '#/pages/registration-tokens/adapter/registrationTokens';
import { useResourceList } from '#/shared/lib/repository/useResourceList';
import type { ResourceListState } from '#/shared/lib/services/resourceList';

export function useTokenList(tenant: string): ResourceListState<RegistrationToken> {
  return useResourceList({
    tenant,
    resource: 'registration-tokens',
    read: (gateway, query) => readTokenPage(gateway, tenant, query),
  });
}
