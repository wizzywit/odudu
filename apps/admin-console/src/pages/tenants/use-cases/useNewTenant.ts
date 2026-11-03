import { useState } from 'react';
import {
  freshCreation,
  useCreationProgress,
  type Creation,
  type CreationFlow,
} from '#/entities/creation-draft';
import { draftOwner, usePrincipal } from '#/entities/session';
import { useSystemIssuer } from '#/pages/tenants/repository/useSystemIssuer';
import { doneOf, type DoneStep } from '#/pages/tenants/services/creationOutcome';
import { creationHeading, pageOf } from '#/pages/tenants/services/creationPosition';
import type { Crumb } from '#/shared/services/breadcrumb';
import { unfinishedOf, type Unfinished } from '#/pages/tenants/services/unfinishedCreation';
import { useStepFeedback, type StepFeedback } from '#/pages/tenants/use-cases/useStepFeedback';

export interface NewTenant {
  // The step the creation is at, which the page turns into that step's form.
  creation: Creation;
  update: (creation: Creation) => void;
  feedback: StepFeedback;
  systemIssuer: string | undefined;
  startOver: () => void;
  // Where the page is among the steps, what it is called and the way back.
  heading: { at: number; title: string; breadcrumb: readonly Crumb[] };
  // What the finished creation says, once it is finished.
  done: DoneStep | null;
  // A subject created but not finished, which starting over would drop.
  replacing: Unfinished | null;
  replace: () => void;
  keep: () => void;
}

// Each page shows its own flow only: creating a tenant, or adding one of
// system's administrators.
export function useNewTenant(flow: CreationFlow): NewTenant {
  const principal = usePrincipal();
  const owner = draftOwner(principal);
  const { creation, update } = useCreationProgress(owner, flow);
  const systemIssuer = useSystemIssuer();
  const feedback = useStepFeedback(update);
  const [replacing, setReplacing] = useState<Unfinished | null>(null);
  const { move } = feedback;

  const replace = (): void => {
    setReplacing(null);
    move(freshCreation(flow));
  };
  return {
    creation,
    update,
    feedback,
    systemIssuer,
    heading: creationHeading(flow, pageOf(creation)),
    done: doneOf(creation, flow),
    startOver: (): void => {
      const unfinished = unfinishedOf(creation);
      if (unfinished === null) replace();
      else setReplacing(unfinished);
    },
    replacing,
    replace,
    keep: (): void => {
      setReplacing(null);
    },
  };
}
