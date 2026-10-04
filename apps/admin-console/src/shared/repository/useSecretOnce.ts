import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { Gateway, GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';
import { useTransport } from '#/shared/transport/useTransport.ts';

export interface SecretOnce<A, Rest> {
  // Never sent twice for one press: the write is a POST, whose repeat would
  // mint a second secret and lose the first.
  start: (args: A) => void;
  busy: boolean;
  // For the SecretDialog, and for nothing else.
  secret: string | null;
  // The rest of the answer, which outlives the dialog.
  outcome: Rest | null;
  failure: GatewayFailure | null;
  close: () => void;
}

type Settled<Rest> = { ok: true; rest: Rest } | { ok: false; failure: GatewayFailure };

// A write whose answer carries one secret shown once; an answer carrying
// several, as an import's does, shows them in a dialog of its own. The secret is split off
// before the mutation settles, so the mutation cache never holds it, and it
// lives in this hook's state until the dialog showing it closes.
export function useSecretOnce<A, R, Rest>({
  run,
  split,
}: {
  run: (gateway: Gateway, args: A) => Promise<GatewayResult<R>>;
  split: (data: R) => { secret: string; rest: Rest };
}): SecretOnce<A, Rest> {
  const { gateway } = useTransport();
  const [secret, setSecret] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mutation = useMutation({
    mutationFn: async (args: A): Promise<Settled<Rest>> => {
      try {
        const result = await run(gateway, args);
        if (!result.ok) return { ok: false, failure: result };
        const parts = split(result.data);
        setSecret(parts.secret);
        return { ok: true, rest: parts.rest };
      } catch {
        return { ok: false, failure: { ok: false, kind: 'defect' } };
      }
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const settled = mutation.data;
  return {
    start: (args) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setSecret(null);
      mutation.mutate(args);
    },
    busy: mutation.isPending,
    secret,
    outcome: settled?.ok === true ? settled.rest : null,
    failure: settled?.ok === false ? settled.failure : null,
    close: () => {
      setSecret(null);
    },
  };
}
