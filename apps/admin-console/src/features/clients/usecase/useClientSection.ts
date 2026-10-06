import type { Client } from '@odudu/contracts/admin';
import { useRefusal } from '#/features/session';
import { useRereadClient } from '#/features/clients/repository/useClientRecord.ts';
import {
  ceilingRefused,
  CLIENT_CAPABILITY,
  clientRecord,
  clientRefusal,
} from '#/features/clients/service';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

// What every section of the client's record saves with: the record, the
// ETag it was read with, what a refusal needs, and what to do about it.
export function useClientSection({
  tenant,
  client,
  etag,
  gone,
}: {
  tenant: string;
  client: Client;
  etag: string;
  gone: boolean;
}) {
  const refusal = useRefusal(tenant);
  const reread = useRereadClient(tenant, client.id);
  return {
    tenant,
    record: clientRecord(client.id),
    etag,
    capability: CLIENT_CAPABILITY,
    gone,
    onRefused: (failure: GatewayFailure) => {
      refusal.report(failure, CLIENT_CAPABILITY);
      if (ceilingRefused(failure)) reread();
    },
    explain: clientRefusal,
  };
}
