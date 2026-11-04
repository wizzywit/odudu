import type { SigningKey, SigningKeyAlg } from '#/entities/signing-key';
import { deleteKey, promoteKey, retireKey, stageKey } from '#/pages/signing-keys/adapter/keys';
import { listKey, overviewKey } from '#/shared/lib/repository/queryKeys';
import { useInvalidate } from '#/shared/lib/repository/useInvalidate';
import { useGuardedWrite } from '#/shared/lib/repository/useGuardedWrite';
import type { Write } from '#/shared/lib/repository/useWrite';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';

// A write's answer changes the lanes and what the overview says about the
// keys, whatever it was: a refused or lost one may still have left them stale.
function useKeysRead(tenant: string): () => void {
  const { invalidate } = useInvalidate();
  return () => {
    invalidate(listKey(tenant, 'keys'), overviewKey(tenant));
  };
}

type KeyWrite<Input, Answer> = Write<Input, GatewayResult<Answer>>;

function useKeyWrite<Input, Answer>(
  tenant: string,
  send: (gateway: Gateway, input: Input) => Promise<GatewayResult<Answer>>,
): KeyWrite<Input, Answer> {
  return useGuardedWrite(send, useKeysRead(tenant));
}

export function useStageKey(tenant: string): KeyWrite<SigningKeyAlg, SigningKey> {
  return useKeyWrite(tenant, (gateway, alg) => stageKey(gateway, tenant, alg));
}

export function usePromoteKey(tenant: string): KeyWrite<string, SigningKey> {
  return useKeyWrite(tenant, (gateway, id) => promoteKey(gateway, tenant, id));
}

export function useRetireKey(tenant: string): KeyWrite<string, SigningKey> {
  return useKeyWrite(tenant, (gateway, id) => retireKey(gateway, tenant, id));
}

export function useDeleteKey(tenant: string): KeyWrite<string, undefined> {
  return useKeyWrite(tenant, (gateway, id) => deleteKey(gateway, tenant, id));
}
