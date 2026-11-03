import type { Client } from '#/entities/client';
import { useState } from 'react';
import { useAuthority } from '#/entities/session';
import { useEvaluation } from '#/pages/clients/repository/useClientEvaluation';
import {
  answerShown,
  askedAfter,
  EVALUATE_CAPABILITY,
  EVALUATE_HEADING,
  EVALUATE_LABEL,
  EVALUATE_RULE,
  NO_ID_TOKEN,
  SCOPE_LABEL,
  SCOPE_RULE,
  SUBJECT_PICKER_LABEL,
  type Artefact,
  type Asked,
} from '#/pages/clients/services/evaluate';
import { readable } from '#/shared/services/access';
import type { AdminCapability } from '#/shared/services/principal';
import { lastChosen, type PickerState } from '#/shared/services/picker';
import { useSubjectPicker, usernameOrId, type Subject } from '#/entities/subject';

// Whether the caller may look at a subject's claims (whoami says view-users
// is held, or has not yet answered), and what the panel says around them.
export interface EvaluatePanel {
  allowed: boolean;
  heading: string;
  rule: string;
  capability: AdminCapability;
}

export function useEvaluatePanel(tenant: string): EvaluatePanel {
  return {
    allowed: readable(useAuthority(tenant), EVALUATE_CAPABILITY),
    heading: EVALUATE_HEADING,
    rule: EVALUATE_RULE,
    capability: EVALUATE_CAPABILITY,
  };
}

export interface ClientEvaluate {
  subjectPickerLabel: string;
  scopeLabel: string;
  scopeRule: string;
  evaluateLabel: string;
  // What an artefact says when the answer holds none.
  noIdToken: string;
  capability: AdminCapability;
  picker: PickerState<Subject>;
  // How a subject is named in the picker: the username, or the ID when it has none.
  subjectLabel: (subject: Subject) => string;
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
    subjectPickerLabel: SUBJECT_PICKER_LABEL,
    scopeLabel: SCOPE_LABEL,
    scopeRule: SCOPE_RULE,
    evaluateLabel: EVALUATE_LABEL,
    noIdToken: NO_ID_TOKEN,
    capability: EVALUATE_CAPABILITY,
    picker,
    subjectLabel: usernameOrId,
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
