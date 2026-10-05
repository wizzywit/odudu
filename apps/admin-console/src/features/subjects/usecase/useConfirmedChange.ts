import { useState } from 'react';
import { useRefusal } from '#/features/session';
import { changeFailureText } from '#/features/subjects/service';
import { useToasts } from '#/shared/repository/useToasts.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';

export interface Confirming<A> {
  asking: A | null;
  busy: boolean;
  // The server's refusal, said in the dialog that asked for it.
  problem: string | null;
  ask: (arg: A) => void;
  cancel: () => void;
  confirm: () => void;
}

// One change behind a plain confirmation: asked, then sent once, its
// refusal said in the dialog and its success in a toast.
export function useConfirmedChange<A, R>({
  tenant,
  capability,
  change,
  done,
}: {
  tenant: string;
  capability: AdminCapability;
  change: { busy: boolean; run: (arg: A) => Promise<GatewayResult<R>> };
  done: (arg: A, data: R) => string;
}): Confirming<A> {
  const refusal = useRefusal(tenant);
  const push = useToasts((queue) => queue.push);
  const [asking, setAsking] = useState<A | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  return {
    asking,
    busy: change.busy,
    problem,
    ask: (arg) => {
      setProblem(null);
      setAsking(arg);
    },
    cancel: () => {
      setProblem(null);
      setAsking(null);
    },
    confirm: () => {
      if (asking === null || change.busy) return;
      const arg = asking;
      setProblem(null);
      change
        .run(arg)
        .then((result) => {
          if (result.ok) {
            setAsking(null);
            push({ tone: 'success', message: done(arg, result.data) });
            return;
          }
          refusal.report(result, capability);
          setProblem(changeFailureText(result, capability));
        })
        .catch(() => {
          setProblem(changeFailureText({ ok: false, kind: 'defect' }, capability));
        });
    },
  };
}
