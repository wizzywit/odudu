import type { ListDomainsResponse } from '#/pages/domains/types/domain';
import { readDomains } from '#/pages/domains/adapter/domains';
import { DOMAINS_RECORD } from '#/pages/domains/services/domainsWords';
import { useRecord, type RecordState } from '#/shared/lib/repository/useRecord';

// The first page of the tenant's domains with the ETag a switch waits on. A
// tenant holds at most as many as one page does, so there is no next page.
export function useDomainsRecord(tenant: string): RecordState<ListDomainsResponse> {
  return useRecord({
    tenant,
    record: DOMAINS_RECORD,
    read: (gateway) => readDomains(gateway, tenant),
  });
}
