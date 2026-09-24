export { createDatabase, type Database, type DatabaseHandle } from '#/client';
export { MIGRATIONS_DIR, runMigrations } from '#/migrate';
export { bypassesRowLevelSecurity } from '#/roles';
export { isUniqueViolation } from '#/sqlstate';
export * from '#/schema/index';
export {
  type ExclusiveTenantPass,
  type TenantScopedDatabase,
  withEachTenantExclusive,
  withTenant,
} from '#/tx';
