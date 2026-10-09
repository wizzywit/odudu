export {
  type SaveStatus,
  type ConflictSource,
  BLOCKED_BY_CONFLICT,
  BLOCKED_UNREAD,
  BLOCKED_GONE,
  type SavePhase,
  type SectionState,
  type SectionField,
  type SectionFields,
  fieldValues,
  changedFrom,
  withoutFields,
} from '#/shared/service/sectionSave/state.ts';
export {
  initialSection,
  rebasedSection,
  editedSection,
  savingSection,
  mineKept,
  theirsTaken,
  discardedSection,
  unsavedAfter,
  startable,
  sectionBlocked,
  conflictsOf,
} from '#/shared/service/sectionSave/transitions.ts';
export {
  saveFailureText,
  type SaveOutcome,
  rereadPhase,
  saveOutcome,
  afterSave,
} from '#/shared/service/sectionSave/outcome.ts';
