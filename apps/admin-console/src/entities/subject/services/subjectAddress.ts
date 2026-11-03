import { resourceAddress } from '#/shared/services/address';
import { tabHrefOf } from '#/shared/services/record';

const subjects = resourceAddress({
  segment: 'subjects',
  group: 'Identity',
  // The area's own title: an entity imports no other entity, so it is not read from the catalogue.
  label: 'Subjects',
});

export const {
  listHref: subjectsHref,
  newHref: newSubjectHref,
  recordHref: subjectHref,
  trail: subjectsTrail,
} = subjects;

// A subject's record, a tab per concern, in the order the page shows them.
export const SUBJECT_TABS = [
  'profile',
  'credentials',
  'groups',
  'roles',
  'required-actions',
  'sessions',
  'consents',
  'grants',
  'activity',
] as const;

export type SubjectTab = (typeof SUBJECT_TABS)[number];

export const subjectTabHref: (tenant: string, id: string, tab: SubjectTab) => string =
  tabHrefOf(subjectHref);
