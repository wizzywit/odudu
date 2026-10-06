import type { Client, Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority } from '#/features/session';
import {
  useEvaluation,
  useSubjectPicker,
} from '#/features/clients/repository/useClientEvaluation.ts';
import {
  artefactsOf,
  evaluateAllowed,
  evaluatedScope,
  evaluateFailureText,
  type Artefact,
} from '#/features/clients/service';
import { lastChosen, type PickerState } from '#/shared/service/picker.ts';

// Whether the caller may look at a subject's claims: whoami says view-users
// is held, or has not yet answered.
export function useEvaluateAllowed(tenant: string): boolean {
  return evaluateAllowed(useAuthority(tenant));
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
  const [asked, setAsked] = useState<{ subject: string; scope: string; press: number } | null>(
    null,
  );
  const evaluation = useEvaluation(tenant, client.id, asked);
  const answer = evaluation.result;
  return {
    picker,
    chosen: picker.options.find((subject) => subject.id === chosenId) ?? null,
    choose: (ids) => {
      setChosenId(lastChosen(ids));
    },
    scope,
    setScope,
    evaluate: () => {
      if (chosenId !== null)
        setAsked((was) => ({ subject: chosenId, scope, press: (was?.press ?? 0) + 1 }));
    },
    busy: evaluation.status === 'loading',
    problem: answer === null || answer.ok ? null : evaluateFailureText(answer),
    worked: answer?.ok === true ? evaluatedScope(answer.data) : null,
    artefacts: answer?.ok === true ? artefactsOf(answer.data) : [],
  };
}
