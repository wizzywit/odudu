import type { Client, Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority } from '#/features/session';
import {
  useEvaluation,
  useSubjectPicker,
} from '#/features/clients/repository/useClientEvaluation.ts';
import {
  artefactsOf,
  EVALUATE_CAPABILITY,
  evaluatedScope,
  evaluateFailureText,
  type Artefact,
} from '#/features/clients/service';
import { lacking } from '#/shared/service/access.ts';
import type { PickerState } from '#/shared/service/picker.ts';

// Whether the caller may look at a subject's claims: whoami says view-users
// is held, or has not yet answered.
export function useEvaluateAllowed(tenant: string): boolean {
  return lacking(useAuthority(tenant), [EVALUATE_CAPABILITY]).length === 0;
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
  const [asked, setAsked] = useState<{ subject: string; scope: string } | null>(null);
  const evaluation = useEvaluation(tenant, client.id, asked);
  const answer = evaluation.result;
  return {
    picker,
    chosen: picker.options.find((subject) => subject.id === chosenId) ?? null,
    choose: (ids) => {
      setChosenId(ids.at(-1) ?? null);
    },
    scope,
    setScope,
    evaluate: () => {
      if (chosenId !== null) setAsked({ subject: chosenId, scope });
    },
    busy: evaluation.status === 'loading',
    problem: answer === null || answer.ok ? null : evaluateFailureText(answer),
    worked: answer?.ok === true ? evaluatedScope(answer.data) : null,
    artefacts: answer?.ok === true ? artefactsOf(answer.data) : [],
  };
}
