import { useState } from 'react';
import { useRefusal } from '#/features/session/index.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';
import type { GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';

export interface Confirming<A> {
  asking: A | null;
  busy: boolean;
  // The server's refusal, said in the dialog that asked for it.
  problem: string | null;
  ask: (arg: A) => void;
  cancel: () => void;
  confirm: () => void;
}

function refusalText(failure: GatewayFailure, capability: AdminCapability): string {
  switch (failure.kind) {
    case 'network':
      return 'Could not confirm the result. Nothing was sent again; the tab shows what the server holds now.';
    case 'schema':
      return 'It may have happened, but the answer could not be read. The tab shows what the server holds now.';
    case 'defect':
      return 'The console could not finish. This is a fault in the console, not something you did.';
    case 'problem':
      if (failure.problem.status === 403) {
        return `Refused: it needs the ${capability} capability, or the subject holds an admin capability you do not.`;
      }
      if (failure.problem.status === 404) return 'It is already gone.';
      return `Refused: ${failure.problem.detail ?? failure.problem.title}`;
  }
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
          setProblem(refusalText(result, capability));
        })
        .catch(() => {
          setProblem(refusalText({ ok: false, kind: 'defect' }, capability));
        });
    },
  };
}
