import type { MintRegistrationTokenResponse } from '@odudu/contracts/admin';
import { mintToken, revokeToken } from '#/pages/registration-tokens/adapter/registrationTokens';
import { listKey } from '#/shared/lib/repository/queryKeys';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { useSecretOnce, type SecretOnce } from '#/shared/lib/repository/useSecretOnce';
import type { GatewayFailure, GatewayResult } from '#/shared/api/transport/gateway';
import { useGatewayWrite, type Write } from '#/shared/lib/repository/useWrite';

type Minted = Omit<MintRegistrationTokenResponse, 'token'>;

function useListRead(tenant: string): () => void {
  const { invalidate } = useInvalidate();
  return () => {
    invalidate(listKey(tenant, 'registration-tokens'));
  };
}

export interface TokenMint {
  busy: boolean;
  start: SecretOnce<{ uses: number; ttl_seconds: number }, Minted>['start'];
  // For the SecretDialog, and for nothing else.
  secret: string | null;
  close: () => void;
}

// The token goes to its dialog alone; what remains of the answer is told on.
export function useTokenMint(
  tenant: string,
  told: { minted: (token: Minted) => void; failed: (failure: GatewayFailure) => void },
): TokenMint {
  const read = useListRead(tenant);
  const once = useSecretOnce({
    run: async (gateway, input: { uses: number; ttl_seconds: number }) => {
      const result = await mintToken(gateway, tenant, input);
      if (result.ok) {
        read();
      } else {
        told.failed(result);
      }
      return result;
    },
    split: ({ token, ...rest }) => {
      told.minted(rest);
      return { secret: token, rest };
    },
  });
  return { busy: once.busy, start: once.start, secret: once.secret, close: once.close };
}

// Whatever the answer, the list is read again: revoked, already gone or lost, it may be stale.
export function useTokenRevoke(tenant: string): Write<string, GatewayResult<undefined>> {
  const read = useListRead(tenant);
  return useGatewayWrite({
    send: (gateway, id: string) => revokeToken(gateway, tenant, id),
    onSettled: read,
  });
}
