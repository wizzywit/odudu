import type { Client, Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority } from '#/entities/session';
import { useEvaluation } from '#/features/clients/repository/useClientEvaluation';
import { useSubjectPicker } from '#/shared/repository/useSubjectPicker';
import {
  answerShown,
  askedAfter,
  EVALUATE_CAPABILITY,
  type Artefact,
  type Asked,
} from '#/features/clients/services/evaluate';
import { readable } from '#/shared/services/access';
import { lastChosen, type PickerState } from '#/shared/services/picker';

// Whether the caller may look at a subject's claims: whoami says view-users
// is held, or has not yet answered.
export function useEvaluateAllowed(tenant: string): boolean {
  return readable(useAuthority(tenant), EVALUATE_CAPABILITY);
}

export interface ClientEvaluate {
  picker: PickerState<Subject>;
  chosen: Subject | null;
  choose: (ids: readonly string[]) => void;
  scope: string;
  setScope: (scope: string) => void;
  evaluate: () => void;
  busy: boolean;
  problem: string | null;
  // The scope the answer was worked out for, and the claims it came to.
  worked: string | null;
  artefacts: readonly Artefact[];
}

export function useClientEvaluate(tenant: string, client: Client): ClientEvaluate {
  const picker = useSubjectPicker(tenant);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [scope, setScope] = useState('');
  const [asked, setAsked] = useState<Asked | null>(null);
  const evaluation = useEvaluation(tenant, client.id, asked);
  return {
    picker,
    chosen: picker.options.find((subject) => subject.id === chosenId) ?? null,
    choose: (ids) => {
      setChosenId(lastChosen(ids));
    },
    scope,
    setScope,
    evaluate: () => {
      if (chosenId !== null) setAsked((was) => askedAfter(was, chosenId, scope));
    },
    busy: evaluation.status === 'loading',
    ...answerShown(evaluation.result),
  };
}
