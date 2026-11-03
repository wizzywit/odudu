import { useState } from 'react';
import type { RefusalReporter } from '#/shared/lib/repository/useSectionSave';
import { useToast } from '#/shared/lib/repository/useToasts';
import { lastChosen } from '#/shared/lib/services/picker';
import type { AdminCapability } from '#/shared/lib/services/principal';
import type { GatewayFailure, GatewayResult } from '#/shared/api/transport/gateway';

export type AssignmentVerb = 'assigned' | 'unassigned';

export interface Counterpart {
  id: string;
  name: string;
}

export interface AssignmentFlow {
  assignment: string;
  setAssignment: (value: string) => void;
  chosenId: string | null;
  choose: (ids: readonly string[]) => void;
  // The one whose change is in flight.
  working: string | null;
  // What the last change said when it did not go through.
  message: string | null;
  // One change at a time: what it said is shown, and whether it went is answered.
  perform: (
    counterpart: Counterpart,
    verb: AssignmentVerb,
    run: () => Promise<GatewayResult<unknown>>,
    done: string,
  ) => Promise<boolean>;
  // Assigns the one chosen, and lets the choice go once it went.
  assignChosen: <T>(
    chosen: T | null,
    assignTo: (chosen: T) => Promise<boolean>,
  ) => Promise<boolean>;
}

// The state a scope and a client share when one assigns the other: what is
// chosen, how it is assigned, and the single change in flight.
export function useAssignmentFlow({
  refusal,
  capability,
  failureText,
  onRefused,
}: {
  refusal: RefusalReporter;
  capability: AdminCapability;
  failureText: (failure: GatewayFailure, counterpart: string, verb: AssignmentVerb) => string;
  // Told of a failure before its text is said, for whatever else it should set going.
  onRefused?: (failure: GatewayFailure) => void;
}): AssignmentFlow {
  const toast = useToast();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [assignment, setAssignment] = useState('default');
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const failed = (failure: GatewayFailure, counterpart: string, verb: AssignmentVerb): void => {
    refusal.report(failure, capability);
    onRefused?.(failure);
    setMessage(failureText(failure, counterpart, verb));
  };

  return {
    assignment,
    setAssignment,
    chosenId,
    choose: (ids) => {
      setChosenId(lastChosen(ids));
    },
    working,
    message,
    perform: (counterpart, verb, run, done) => {
      if (working !== null) return Promise.resolve(false);
      setWorking(counterpart.id);
      setMessage(null);
      return run()
        .then((result): boolean => {
          if (!result.ok) {
            failed(result, counterpart.name, verb);
            return false;
          }
          toast.succeeded(done);
          return true;
        })
        .catch((): boolean => {
          failed({ ok: false, kind: 'defect' }, counterpart.name, verb);
          return false;
        })
        .finally(() => {
          setWorking(null);
        });
    },
    assignChosen: async (chosen, assignTo) => {
      if (chosen === null) return false;
      const went = await assignTo(chosen);
      if (went) setChosenId(null);
      return went;
    },
  };
}
