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
} from '#/features/groups/services/address';
export {
  GROUP_TABS,
  type GroupTab,
  GROUP_TAB_LABELS,
  groupRecord,
  groupRolesRecord,
  TAB_RECORDS,
} from '#/features/groups/services/tabs';
export { groupListScope } from '#/features/groups/services/list';
export {
  NAME_FIXED,
  PLACE_LABEL,
  DEFAULT_LABEL,
  NAME_TAKEN,
} from '#/features/groups/services/labels';
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
} from '#/features/groups/services/blocks';
export { type Change, selfLoss, lossOf, type Readiness } from '#/features/groups/services/loss';
export {
  type GroupRead,
  namedGroupRead,
  type Ceiling,
  groupCeiling,
  createUnderHref,
  groupReadiness,
  createBlocked,
  createHeld,
  placeText,
  newGroupPlace,
  parentPathOf,
  parentPlace,
  ceilingParentReach,
  ceilingLines,
} from '#/features/groups/services/ceiling';
export {
  moveConfirmation,
  deleteConsequence,
  subtreeDeletedText,
  rolesConfirmation,
} from '#/features/groups/services/confirm';
export { keptRoles, reachOfRoles } from '#/features/groups/services/mapped';
