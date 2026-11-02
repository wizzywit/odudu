export {
  type Role,
  rolesHref,
  newRoleHref,
  copyHref,
  roleHref,
  rolesTrail,
  copyHrefOf,
} from '#/features/roles/services/address';
export {
  ROLE_TABS,
  type RoleTab,
  ROLE_TAB_LABELS,
  roleRecord,
  compositesRecord,
  TAB_RECORDS,
} from '#/features/roles/services/tabs';
export { NAME_FIXED, DEFAULT_LABEL, ADD_LABEL, NEST_LABEL } from '#/features/roles/services/labels';
export {
  isBuiltin,
  deleteBlock,
  defaultBlock,
  childUnavailable,
  compositeRefusal,
  addRefusal,
  compositesFixed,
  deletionFixed,
  childRows,
  type Child,
} from '#/features/roles/services/blocks';
export {
  type RoleChange,
  roleSelfLoss,
  type Asked,
  type Ceiling,
  roleCeiling,
  isDeleteHeld,
  defaultsChecking,
  compositesOffered,
} from '#/features/roles/services/ceiling';
export {
  compositeRemovalConfirmation,
  unnestedText,
  compositeRemovalFailureText,
  type RemovalAction,
  removalAction,
  deleteChecking,
  roleDeleteConsequence,
  roleDeleteFailureText,
} from '#/features/roles/services/removal';
export {
  type CopyRead,
  type Copying,
  type CopyPlan,
  copyPlan,
  copySourceOf,
  sourceChildren,
  copyingOf,
  copyingText,
  sourceDescription,
  partialCopy,
} from '#/features/roles/services/copy';
