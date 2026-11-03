import type { SigningKey, SigningKeyAlg } from '@odudu/contracts/admin';
import { useRef } from 'react';
import { deleteKey, promoteKey, retireKey, stageKey } from '#/pages/signing-keys/adapter/keys';
import { listKey, overviewKey } from '#/shared/repository/queryKeys';
import { useInvalidate } from '#/shared/repository/useInvalidate';
import { useGatewayWrite, type Write } from '#/shared/repository/useWrite';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';

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
  const read = useKeysRead(tenant);
  // One press is one write, however often it is pressed before the first answer.
  const sending = useRef(false);
  const write = useGatewayWrite({
    send,
    onSettled: () => {
      sending.current = false;
      read();
    },
  });
  return {
    busy: write.busy,
    run: (input) => {
      if (sending.current) return Promise.resolve({ ok: false, kind: 'defect' });
      sending.current = true;
      return write.run(input);
    },
  };
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
