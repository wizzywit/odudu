import type { Client } from '#/entities/client';
import { findKey } from '#/shared/lib/repository/queryKeys';
import { createClient, findClient, type NewClient } from '#/pages/clients/adapter/clients';
import { useAfterClientChange } from '#/pages/clients/repository/useClientRecord';
import { splitSecret } from '#/pages/clients/services/createdSecret';
import { useFreshRead } from '#/shared/lib/repository/useFreshRead';
import { useSecretOnce, type SecretOnce } from '#/shared/lib/repository/useSecretOnce';
import type { GatewayFailure, GatewayResult } from '#/shared/api/transport/gateway';
import { useTransport } from '#/shared/api/transport/useTransport';

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
      fresh.read(findKey(tenant, 'clients', clientId), () => findClient(gateway, tenant, clientId)),
  };
}
