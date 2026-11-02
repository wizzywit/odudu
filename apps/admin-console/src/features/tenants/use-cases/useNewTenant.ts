import { useState } from 'react';
import { draftOwner, usePrincipal } from '#/entities/session';
import { useCreationProgress } from '#/features/tenants/repository/useCreation';
import { useSystemIssuer } from '#/features/tenants/repository/useSystemIssuer';
import {
  freshCreation,
  unfinishedOf,
  type Creation,
  type CreationFlow,
  type Unfinished,
} from '#/features/tenants/services/creation';
import { useStepFeedback, type StepFeedback } from '#/features/tenants/use-cases/useStepFeedback';

export interface NewTenant {
  // The step the creation is at, which the page turns into that step's form.
  creation: Creation;
  update: (creation: Creation) => void;
  feedback: StepFeedback;
  systemIssuer: string | undefined;
  startOver: () => void;
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
