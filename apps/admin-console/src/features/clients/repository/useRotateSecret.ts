import type { RotateClientSecretResponse } from '@odudu/contracts/admin';
import { rotateClientSecret } from '#/features/clients/adapter/clients.ts';
import { useRereadClient } from '#/features/clients/repository/useClientRecord.ts';
import { splitSecret } from '#/features/clients/service';
import { useSecretOnce, type SecretOnce } from '#/shared/repository/useSecretOnce.ts';

// A client's secret is replaced and shown once; the client is read again
// for the moment the replaced one stops authenticating.
export function useRotateSecret(
  tenant: string,
  clientDbId: string,
): SecretOnce<{ grace: number }, Omit<RotateClientSecretResponse, 'client_secret'>> {
  const reread = useRereadClient(tenant, clientDbId);
  return useSecretOnce({
    run: async (gateway, { grace }: { grace: number }) => {
      const result = await rotateClientSecret(gateway, tenant, clientDbId, grace);
      reread();
      return result;
    },
    split: (data) => splitSecret(data),
  });
}
