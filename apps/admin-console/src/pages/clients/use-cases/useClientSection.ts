import type { ClientRecord } from '#/pages/clients/types/clientRecord';
import { useRefusal } from '#/entities/session';
import { useRereadClient } from '#/pages/clients/repository/useClientRecord';
import { ceilingRefused, CLIENT_CAPABILITY, clientRefusal } from '#/pages/clients/services/refusal';
import { clientRecord } from '#/pages/clients/services/tabs';
import type { GatewayFailure } from '#/shared/api/transport/gateway';

// The client's record as a tab is given it: the ETag it was read with, and
// whether it has since been found deleted.
export interface ClientRecordRead {
  tenant: string;
  client: ClientRecord;
  etag: string;
  gone: boolean;
}

// What every section of the client's record saves with: the record, the
// ETag it was read with, what a refusal needs, and what to do about it.
export function useClientSection({ tenant, client, etag, gone }: ClientRecordRead) {
  const refusal = useRefusal(tenant);
  const reread = useRereadClient(tenant, client.id);
  return {
    tenant,
    record: clientRecord(client.id),
    etag,
    capability: CLIENT_CAPABILITY,
    gone,
    refusal,
    onRefused: (failure: GatewayFailure) => {
      if (ceilingRefused(failure)) reread();
    },
    explain: clientRefusal,
  };
}
