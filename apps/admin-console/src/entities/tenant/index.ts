export {
  useTenantSettings,
  readTenantSettings,
  amendTenantSettings,
} from '#/entities/tenant/use-cases/tenantSettingsAccess';
export { useTenantSettingsRead } from '#/entities/tenant/use-cases/useTenantSettingsRead';
export { useOfferedLocales } from '#/entities/tenant/use-cases/useOfferedLocales';
export { TENANT_SETTINGS_RECORD } from '#/entities/tenant/services/tenantSettings';
export { disableFixed, disableConsequence } from '#/entities/tenant/services/tenantEnabled';
export { offeredLocales } from '#/entities/tenant/services/offeredLocales';
