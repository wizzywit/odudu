import { readTermsAcceptances } from '#/pages/subjects/adapter/termsAcceptances';
import { useResourceList } from '#/shared/lib/repository/useResourceList';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import { type TermsAcceptance } from '#/pages/subjects/types/termsAcceptance';

function acceptancesResource(id: string): string {
  return ['subjects', id, 'terms-acceptances'].join('/');
}

export function useTermsAcceptanceList(
  tenant: string,
  id: string,
): ResourceListState<TermsAcceptance> {
  return useResourceList({
    tenant,
    resource: acceptancesResource(id),
    read: (gateway, query) => readTermsAcceptances(gateway, tenant, id, query),
  });
}
