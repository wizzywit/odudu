export {
  ADMIN_CLIENT_KEY,
  type Holding,
  CAPABILITY_TEXT,
  fullText,
  holdingLabel,
  grantableIn,
  holdingsIn,
  isHolding,
  adminClientOfRoles,
  holdingRoleIds,
  isAdminRole,
  includedBy,
} from '#/shared/service/capabilities/holdings.ts';
export {
  provenanceText,
  type Held,
  heldCapabilities,
  ceilingOf,
  beyondCaller,
  TENANT_ROLE_TEXT,
  roleOwnerText,
  holdingNote,
  type HoldingOption,
  holdingOptions,
} from '#/shared/service/capabilities/held.ts';
export { writeRefusal } from '#/shared/service/capabilities/refusal.ts';
export {
  adminLoss,
  type OwnAccess,
  type OwnAccessRead,
  possibleLoss,
  type Asked,
  type Loss,
  judgedLoss,
  lossText,
  asksFirst,
  lossBlocked,
} from '#/shared/service/capabilities/loss.ts';
