export {
  clientsHref,
  newClientHref,
  clientHref,
  clientsTrail,
} from '#/features/clients/service/address.ts';
export {
  CLIENT_TABS,
  type ClientTab,
  CLIENT_TAB_LABELS,
  clientTabHref,
  clientRecord,
  tabsWithEdits,
} from '#/features/clients/service/tabs.ts';
export {
  DESCRIPTION_MAX,
  DESCRIPTION_RULE,
  CLIENT_ID_FIXED,
  TYPE_FIXED,
  CLIENT_ID_TAKEN,
  REDIRECTS_RULE,
  ORIGINS_RULE,
  PAGES_RULE,
  NOT_BUILT,
  POST_LOGOUT_NOTE,
  registeredText,
  TYPE_TEXT,
  SECTION,
  FIELD,
} from '#/features/clients/service/labels.ts';
export {
  type HeldRead,
  type Reach,
  clientReach,
  canChange,
  reachLine,
} from '#/features/clients/service/ceiling.ts';
export {
  type Fixable,
  enabledFixed,
  redirectsFixed,
  listsReadOnly,
  deleteFixed,
} from '#/features/clients/service/blocks.ts';
export { deleteConsequence, deletedText } from '#/features/clients/service/confirm.ts';
export {
  type NewClientType,
  type NewClientField,
  type TypeChoice,
  TYPE_CHOICES,
  NEW_CLIENT_FIELDS,
  newClientType,
  clientIdProblem,
  SECRET_LABEL,
  secretTitle,
  secretNote,
} from '#/features/clients/service/create.ts';
export { CLIENT_LIST_LIMIT, listCount } from '#/features/clients/service/lists.ts';
export { CLIENT_CAPABILITY, clientRefusal } from '#/features/clients/service/refusal.ts';
