export {
  type Role,
  rolesHref,
  newRoleHref,
  copyHref,
  roleHref,
  rolesTrail,
  copyHrefOf,
} from '#/features/roles/service/address.ts';
export {
  ROLE_TABS,
  type RoleTab,
  ROLE_TAB_LABELS,
  roleRecord,
  compositesRecord,
  TAB_RECORDS,
} from '#/features/roles/service/tabs.ts';
export {
  NAME_FIXED,
  DESCRIPTION_MAX,
  DESCRIPTION_RULE,
  NAME_TAKEN,
  DEFAULT_LABEL,
  ADD_LABEL,
  NEST_LABEL,
} from '#/features/roles/service/labels.ts';
export {
  isBuiltin,
  deleteBlock,
  defaultBlock,
  removalBlock,
  childUnavailable,
  compositeRefusal,
  addRefusal,
  compositesFixed,
  deletionFixed,
} from '#/features/roles/service/blocks.ts';
export {
  type RoleChange,
  roleSelfLoss,
  type Asked,
  type Ceiling,
  roleCeiling,
  isDeleteHeld,
  defaultsChecking,
  compositesOffered,
} from '#/features/roles/service/ceiling.ts';
export {
  compositeRemovalConfirmation,
  unnestedText,
  compositeRemovalFailureText,
  type RemovalAction,
  removalAction,
  deleteChecking,
  roleDeleteConsequence,
  roleDeleteFailureText,
} from '#/features/roles/service/removal.ts';
export {
  type CopyRead,
  type Copying,
  type PartialCopy,
  type CopyPlan,
  copyPlan,
  copyingOf,
  copyingText,
  copiedDescription,
  partialCopy,
} from '#/features/roles/service/copy.ts';
