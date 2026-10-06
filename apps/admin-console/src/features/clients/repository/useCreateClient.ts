import type { Client } from '@odudu/contracts/admin';
import { useQueryClient } from '@tanstack/react-query';
import { createClient, findClient, type NewClient } from '#/features/clients/adapter/clients.ts';
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
    // `withSecret` is whether a dialog is showing one, which the page waits on.
    created: (client: Client, withSecret: boolean) => void;
    failed: (failure: GatewayFailure) => void;
  },
): CreateClient {
  const { gateway } = useTransport();
  const queries = useQueryClient();
  const fresh = useFreshRead();
  const creation = useSecretOnce({
    run: async (at, input: NewClient) => {
      const result = await createClient(at, tenant, input).catch((): GatewayFailure => {
        return { ok: false, kind: 'defect' };
      });
      if (!result.ok) {
        told.failed(result);
        return result;
      }
      for (const key of [
        ['list', tenant, 'clients'],
        ['count', tenant],
      ]) {
        queries.invalidateQueries({ queryKey: key }).catch(() => undefined);
      }
      // The secret is split off here, so nothing but the dialog's own state holds it.
      const { client_secret: secret, ...client } = result.data;
      told.created(client, secret !== undefined);
      return result;
    },
    split: ({ client_secret: secret, ...rest }) => ({ secret: secret ?? null, rest }),
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
