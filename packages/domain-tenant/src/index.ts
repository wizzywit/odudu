export { verifyClientSecret } from '#/service/client';
export {
  coerceTenantSetting,
  TENANT_SETTING_NAMES,
  TENANT_SETTING_COLUMNS,
  type CoerceOutcome,
  type TenantSettingName,
  type TenantSettingColumn,
} from '#/service/tenant-settings';
export {
  tenantSettingsRepository,
  TenantSettingCheckViolationError,
  type TenantSettingsRecord,
} from '#/repository/tenant-settings';
export {
  ADMIN_API_AUDIENCE,
  ADMIN_CLIENT_ID,
  isSystemTenantName,
  MANAGE_TENANTS,
  SYSTEM_TENANT_ID,
  SYSTEM_TENANT_NAME,
  TENANT_ADMIN,
  TENANT_CAPABILITIES,
  viewCounterpart,
  type TenantCapability,
} from '#/service/admin-capabilities';
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
export { clientScopeRepository, type NewClientScope } from '#/repository/client-scopes';
export {
  provisionClientDefaults,
  provisionTenantDefaults,
  TENANT_DEFAULT_SCOPE_NAMES,
} from '#/usecase/provision-defaults';
export {
  consents,
  consentScopes,
  type ConsentRecord,
  type ConsentScopeRecord,
} from '#/schema/consents';
export { consentRepository } from '#/repository/consents';
export {
  clientRegistrationTokens,
  type ClientRegistrationTokenRecord,
} from '#/schema/client-registration-tokens';
export {
  clientRegistrationTokenRepository,
  type MintClientRegistrationToken,
} from '#/repository/client-registration-tokens';
export {
  provisionAdminClient,
  type ProvisionAdminClientOptions,
  type ProvisionedAdminClient,
} from '#/usecase/provision-admin-client';
