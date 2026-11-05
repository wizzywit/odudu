export { verifyClientSecret } from '#/service/client';
export { normalizeDisplayName } from '#/service/display-name';
export {
  coerceTenantSetting,
  listSettingValues,
  tenantSettingProblems,
  TENANT_SETTING_NAMES,
  TENANT_SETTING_COLUMNS,
  type CoerceOutcome,
  type TenantSettingName,
  type TenantSettingValue,
  type TenantSettingColumn,
  type TenantSettingProblem,
} from '#/service/tenant-settings';
export {
  TENANT_SETTING_ORDERINGS,
  TENANT_SETTING_RANGES,
  type TenantSettingRange,
} from '@odudu/contracts/admin';
export {
  MAX_MESSAGE_OVERRIDES,
  messageOverrideRepository,
  type MessageOverrideDeps,
  type MessageOverrideRecord,
  type OverridePrecondition,
  type NewMessageOverride,
  type PutMessageOverrideOutcome,
} from '#/repository/message-overrides';
export { messageOverrides } from '#/schema/message-overrides';
export {
  tenantSettingsRepository,
  TenantSettingCheckViolationError,
  type TenantSettingsRecord,
} from '#/repository/tenant-settings';
export {
  ADMIN_API_AUDIENCE,
  ADMIN_CLIENT_ID,
  CONSOLE_CALLBACK_PATH,
  CONSOLE_POST_LOGOUT_PATH,
  isSystemTenantName,
  isSystemTenantId,
  SYSTEM_TENANT_DISABLE_REFUSED,
  MANAGE_TENANTS,
  SYSTEM_TENANT_ID,
  SYSTEM_TENANT_NAME,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
  viewCounterpart,
  type TenantCapability,
} from '#/service/admin-capabilities';
export {
  MCP_CLIENT_ID,
  MCP_CLIENT_LIFETIMES,
  MCP_CLIENT_NAME,
  MCP_CLIENT_REDIRECT_URIS,
  holdsMcpScope,
  isMcpScope,
  MCP_READ_SCOPE,
  MCP_SCOPES,
  MCP_WRITE_SCOPE,
} from '#/service/mcp-client';
export {
  isReservedTenantName,
  isValidTenantName,
  RESERVED_TENANT_NAMES,
  TENANT_NAME_RULE,
} from '#/service/tenant-name';
export { clients, type ClientRecord } from '#/schema/clients';
export {
  clientRepository,
  ClientIdConflictError,
  type ClientCapacity,
  type NewClient,
} from '#/repository/clients';
export {
  clientScopes,
  clientScopeAssignments,
  type ClientScopeAssignment,
  type ClientScopeRecord,
} from '#/schema/client-scopes';
export {
  ClientScopeLimitError,
  DefaultScopeLimitError,
  clientScopeRepository,
  type NewClientScope,
  type ClientScopePatch,
} from '#/repository/client-scopes';
export { clientScopeMappers } from '#/schema/client-scope-mappers';
export { clientScopeMapperRepository } from '#/repository/client-scope-mappers';
export {
  isBuiltinScopeName,
  missingBuiltinScopeNames,
  provisionClientDefaults,
  provisionTenantDefaults,
  restoreBuiltinScopes,
  TENANT_DEFAULT_SCOPE_NAMES,
  type RestoreBuiltinScopesOutcome,
} from '#/usecase/provision-defaults';
export {
  consents,
  consentScopes,
  type ConsentRecord,
  type ConsentScopeRecord,
} from '#/schema/consents';
export { consentRepository, type SubjectConsent } from '#/repository/consents';
export {
  clientRegistrationTokens,
  type ClientRegistrationTokenRecord,
} from '#/schema/client-registration-tokens';
export {
  clientRegistrationTokenRepository,
  type MintClientRegistrationToken,
  type MintedClientRegistrationToken,
  type RegistrationTokenRecord,
} from '#/repository/client-registration-tokens';
export { assignMcpScope } from '#/usecase/assign-mcp-scope';
export { provisionMcpClient } from '#/usecase/provision-mcp-client';
export {
  capabilityRoleGraph,
  provisionAdminClient,
  type CapabilityRoleGraph,
  type ProvisionAdminClientOptions,
  type ProvisionedAdminClient,
} from '#/usecase/provision-admin-client';
export {
  baseIsTls,
  canonicalAddressFor,
  type LookupCanonicalDomain,
} from '#/usecase/canonical-address';
export {
  canonicalHostOf,
  CanonicalConflictError,
  DomainConflictError,
  hostState,
  lookupHost,
  MAX_DOMAINS_PER_TENANT,
  tenantAddressing,
  tenantDomainRepository,
  verifiedDomainPage,
  type DomainConflict,
  type DomainRow,
  type HostRoute,
  type HostState,
  type NewDomain,
  type RetiredIssuer,
  type TenantAddressing,
  type VerifiedDomainRow,
} from '#/repository/tenant-domains';
export { tenantDomains, tenantIssuerRetirements, type DomainState } from '#/schema/tenant-domains';
export {
  canonicalHost,
  challengeName,
  CHALLENGE_PREFIX,
  DOMAIN_CODES,
  newChallenge,
  refuseHost,
  REFUSAL_CODES,
  lookupTxtOutcome,
  txtMatchesChallenge,
  type ResolveTxt,
  type TxtOutcome,
  type DomainCode,
  type DomainRefusal,
} from '#/service/tenant-domain';
export {
  verifyDomain,
  type VerifyDomainDomains,
  type VerifyDomainDeps,
  type VerifyDomainOutcome,
} from '#/usecase/verify-domain';
export {
  recheckDomains,
  type RecheckAuditEvent,
  type RecheckDomainsDeps,
  type RecheckReport,
  type RecheckScope,
} from '#/usecase/recheck-domains';
export {
  switchCanonical,
  type SwitchCanonicalDeps,
  type SwitchDomains,
  type SwitchOptions,
  type SwitchOutcome,
  type SwitchTarget,
} from '#/usecase/switch-canonical';
export {
  registerDomain,
  type RegisterDomainDeps,
  type RegisterDomainOutcome,
} from '#/usecase/register-domain';
export {
  dnsChallengeResolver,
  DEFAULT_LOOKUP_TIMEOUT_MS,
  type DnsChallengeOptions,
} from '#/adapter/dns-challenge';
