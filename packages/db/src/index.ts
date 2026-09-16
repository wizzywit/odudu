export { createDatabase, type Database, type DatabaseHandle } from '#/client';
export { MIGRATIONS_DIR, runMigrations } from '#/migrate';
export * from '#/schema/index';
export {
  type ExclusiveRealmPass,
  type RealmScopedDatabase,
  withEachRealmExclusive,
  withRealm,
} from '#/tx';
