import { useTermsAcceptanceList } from '#/pages/subjects/repository/useTermsAcceptances';
import {
  noTermsAcceptedText,
  TERMS_ACCEPTED_RULE,
  TERMS_ACCEPTED_TITLE,
  termsAcceptedLabel,
} from '#/pages/subjects/services/termsAcceptances';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import { type TermsAcceptance } from '#/pages/subjects/types/termsAcceptance';
import { type Subject, subjectName } from '#/entities/subject';

export interface SubjectTermsAcceptances {
  title: string;
  rule: string;
  list: ResourceListState<TermsAcceptance>;
  label: string;
  empty: string;
}

export function useSubjectTermsAcceptances(
  tenant: string,
  subject: Subject,
): SubjectTermsAcceptances {
  const name = subjectName(subject);
  return {
    title: TERMS_ACCEPTED_TITLE,
    rule: TERMS_ACCEPTED_RULE,
    list: useTermsAcceptanceList(tenant, subject.id),
    label: termsAcceptedLabel(name),
    empty: noTermsAcceptedText(name),
  };
}
