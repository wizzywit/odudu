export {
  type Group,
  type GroupRecord,
  lossText,
  possibleLoss,
  type Loss,
  type OwnAccess,
  groupsHref,
  newGroupHref,
  groupHref,
  groupsTrail,
  type Asked,
} from '#/features/groups/service/address.ts';
export {
  GROUP_TABS,
  type GroupTab,
  GROUP_TAB_LABELS,
  groupRecord,
  groupRolesRecord,
  TAB_RECORDS,
} from '#/features/groups/service/tabs.ts';
export {
  NAME_FIXED,
  DESCRIPTION_MAX,
  DESCRIPTION_RULE,
  PLACE_LABEL,
  DEFAULT_LABEL,
  NAME_TAKEN,
} from '#/features/groups/service/labels.ts';
export {
  moveUnavailable,
  moveRefusal,
  type ReachLines,
  reachLines,
  defaultBlock,
  parentUnavailable,
  type Defaulting,
  defaultingOf,
  roleUnavailable,
} from '#/features/groups/service/blocks.ts';
export { type Change, selfLoss, lossOf, type Readiness } from '#/features/groups/service/loss.ts';
export {
  type GroupRead,
  type Ceiling,
  groupCeiling,
  createUnderHref,
  groupReadiness,
  createHeld,
  placeText,
  newGroupPlace,
  parentPathOf,
  parentPlace,
  ceilingCaller,
  ceilingParentReach,
  ceilingLines,
} from '#/features/groups/service/ceiling.ts';
export {
  moveConfirmation,
  deleteConsequence,
  subtreeDeletedText,
  rolesConfirmation,
} from '#/features/groups/service/confirm.ts';
export {
  type Mapped,
  roleIndex,
  mappedRoles,
  keptRoles,
  reachOfRoles,
  withKept,
} from '#/features/groups/service/mapped.ts';
