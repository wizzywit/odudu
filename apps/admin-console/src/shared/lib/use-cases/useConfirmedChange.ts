import { useState } from 'react';
import type { RefusalReporter } from '#/shared/lib/repository/useSectionSave';
import type { Write } from '#/shared/lib/repository/useWrite';
import type { AdminCapability } from '#/shared/lib/services/principal';
import type { GatewayFailure, GatewayResult } from '#/shared/api/transport/gateway';

export interface Confirming<A> {
  asking: A | null;
  busy: boolean;
  // The server's refusal, said in the dialog that asked for it.
  problem: string | null;
  ask: (arg: A) => void;
  cancel: () => void;
  confirm: () => void;
}

export interface ConfirmedChange<A, R> {
  refusal: RefusalReporter;
  // What the change needs, named when a 403 refuses it.
  capability: AdminCapability;
  change: Write<A, GatewayResult<R>>;
  // What the dialog says of a failure, a lost answer included.
  failureText: (failure: GatewayFailure) => string;
  // Told once the change has gone through, after the dialog has closed.
  done: (arg: A, data: R) => void;
  // Told of a failure before its text is said, for whatever else it should set going.
  onRefused?: (failure: GatewayFailure) => void;
}

// One change behind a plain confirmation: asked, then sent once, its
// refusal said in the dialog.
export function useConfirmedChange<A, R>({
  refusal,
  capability,
  change,
  failureText,
  done,
  onRefused,
}: ConfirmedChange<A, R>): Confirming<A> {
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
            done(arg, result.data);
            return;
          }
          refusal.report(result, capability);
          onRefused?.(result);
          setProblem(failureText(result));
        })
        .catch(() => {
          setProblem(failureText({ ok: false, kind: 'defect' }));
        });
    },
  };
}

export interface Removal {
  confirming: boolean;
  busy: boolean;
  problem: string | null;
  ask: () => void;
  cancel: () => void;
  confirm: () => void;
}

// A change with nothing to choose between, asked as a yes or a no: the
// removal of the record whose page it is.
export function useConfirmedRemoval<R>({
  change,
  done,
  ...rest
}: Omit<ConfirmedChange<true, R>, 'change' | 'done'> & {
  change: Write<void, GatewayResult<R>>;
  done: (data: R) => void;
}): Removal {
  const confirming = useConfirmedChange<true, R>({
    ...rest,
    change: { busy: change.busy, run: () => change.run() },
    done: (_asked, data) => {
      done(data);
    },
  });
  return {
    confirming: confirming.asking !== null,
    busy: confirming.busy,
    problem: confirming.problem,
    ask: () => {
      confirming.ask(true);
    },
    cancel: confirming.cancel,
    confirm: confirming.confirm,
  };
}
