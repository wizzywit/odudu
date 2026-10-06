import type { Client } from '@odudu/contracts/admin';
import { createClient, findClient, type NewClient } from '#/features/clients/adapter/clients.ts';
import { useAfterClientChange } from '#/features/clients/repository/useClientRecord.ts';
import { splitSecret } from '#/features/clients/service';
import { useFreshRead } from '#/shared/repository/useFreshRead.ts';
import { useSecretOnce, type SecretOnce } from '#/shared/repository/useSecretOnce.ts';
import type { GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface CreateClient {
  // Creating, or looking for a client whose creation was not confirmed.
  busy: boolean;
  create: SecretOnce<NewClient, Client>['start'];
  // For the SecretDialog, and for nothing else.
  secret: string | null;
  closeSecret: () => void;
  // For a creation whose answer was lost: never sent twice, looked for instead.
  find: (clientId: string) => Promise<GatewayResult<Client | null>>;
}

export function useCreateClient(
  tenant: string,
  told: {
    // `secret` is what a dialog is about to show, which the page waits on.
    created: (client: Client, secret: string | null) => void;
    failed: (failure: GatewayFailure) => void;
  },
): CreateClient {
  const { gateway } = useTransport();
  const after = useAfterClientChange(tenant);
  const fresh = useFreshRead();
  const creation = useSecretOnce({
    run: async (at, input: NewClient) => {
      const result = after(
        await createClient(at, tenant, input).catch((): GatewayFailure => {
          return { ok: false, kind: 'defect' };
        }),
      );
      if (!result.ok) {
        told.failed(result);
        return result;
      }
      const { secret, rest } = splitSecret(result.data);
      told.created(rest, secret);
      return result;
    },
    split: (data) => splitSecret(data),
  });
  return {
    busy: creation.busy || fresh.pending,
    create: creation.start,
    secret: creation.secret,
    closeSecret: creation.close,
    find: (clientId) =>
      fresh.read(['find', tenant, 'clients', clientId], () =>
        findClient(gateway, tenant, clientId),
      ),
  };
}
