export {
  createDatabase,
  DEFAULT_POOL_MAX,
  type Database,
  type DatabaseHandle,
  type DatabaseOptions,
} from '#/client';
export { MIGRATIONS_DIR, runMigrations } from '#/migrate';
export { bypassesRowLevelSecurity } from '#/roles';
export { stampPasskeyRelyingParty } from '#/credential-rp-id';
export { TENANT_PAGE_SIZE, tenantIdPages } from '#/tenant-pages';
export {
  isUniqueViolation,
  isCheckViolation,
  isForeignKeyViolation,
  violatedConstraint,
  isLockNotAvailable,
} from '#/sqlstate';
export * from '#/schema/index';
export {
  type ExclusiveTenantPass,
  type RequestContext,
  type TenantScopedDatabase,
  withEachTenantExclusive,
  withSavepoint,
  withTenant,
  withTenantThen,
} from '#/tx';
