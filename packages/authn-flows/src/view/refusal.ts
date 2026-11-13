import { type PageLocale } from '@odudu/kernel';
import { type EnrolmentRefusal } from '#/schema/enrolment-refusal';
import { type Problem } from '#/view/form-error';
import { tHtml, type MessageId } from '#/view/messages';

const REFUSAL_MESSAGE: Readonly<Record<EnrolmentRefusal, MessageId>> = {
  code_mismatch: 'refusal.codeMismatch',
  codes_not_saved: 'refusal.codesNotSaved',
  passkey_not_added: 'refusal.passkeyNotAdded',
  passkey_not_discoverable: 'refusal.passkeyNotDiscoverable',
};

// Why an enrolment page is back, or nothing on a first visit. `field` names
// the input the refusal is about, or null when it is about the step as a
// whole.
export function refusalProblems(
  locale: PageLocale,
  refusal: EnrolmentRefusal | undefined,
  field: string | null,
): Problem[] {
  return refusal === undefined
    ? []
    : [{ fields: field === null ? [] : [field], html: tHtml(locale, REFUSAL_MESSAGE[refusal]) }];
}
