import type { RotatedSecret } from '#/pages/clients/types/clientRecord';
import { rotateClientSecret } from '#/pages/clients/adapter/clients';
import { useRereadClient } from '#/pages/clients/repository/useClientRecord';
import { splitSecret } from '#/pages/clients/services/createdSecret';
import { useSecretOnce, type SecretOnce } from '#/shared/lib/repository/useSecretOnce';

// A client's secret is replaced and shown once; the client is read again
// for the moment the replaced one stops authenticating.
export function useRotateSecret(
  tenant: string,
  clientDbId: string,
): SecretOnce<{ grace: number }, Omit<RotatedSecret, 'client_secret'>> {
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
