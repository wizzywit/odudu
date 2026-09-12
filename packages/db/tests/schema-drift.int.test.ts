import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';

// The hand-written SQL in packages/db/drizzle/ is the source of truth for
// the schema; the pgTable declarations are a typed view of it that nothing
// generates and nothing checks. This file is the check. See
// packages/db/README.md for why it is a test rather than `drizzle-kit
// generate`.
//
// Tables are found on disk rather than imported: @odudu/db sits underneath
// every package that owns a table, so importing their schemas here would
// invert the dependency. Discovery also means a table added in a package
// this file has never heard of is covered the day it lands.
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

// Drizzle's migration bookkeeping table is created by the migrator itself
// and declared by nobody.
const UNDECLARED_TABLES = new Set(['__drizzle_migrations']);

// CHECK constraints live only in the migrations: drizzle's `check()` is not
// used anywhere, so nothing in TypeScript records that these exist and a
// reader of users.ts sees `email: text('email')` with no hint of the RFC
// 5322 shape the column enforces. Recording them here is what makes a
// migration that adds, drops or rewrites one visible — the expression is
// pg_get_constraintdef's own rendering, so it is compared verbatim.
const EXPECTED_CHECKS: Record<string, string> = {
  'authorization_codes.authorization_codes_method_check':
    "CHECK ((code_challenge_method = 'S256'::text))",
  'client_oidc_config.client_oidc_config_access_token_ttl_ceiling':
    'CHECK (((access_token_ttl_seconds >= 1) AND (access_token_ttl_seconds <= 3600)))',
  'client_oidc_config.client_oidc_config_auth_method_check':
    "CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))",
  'client_oidc_config.client_oidc_config_grant_types_check':
    "CHECK ((grant_types <@ ARRAY['authorization_code'::text, 'refresh_token'::text, 'client_credentials'::text]))",
  'client_oidc_config.client_oidc_config_redirect_uris_present':
    "CHECK (((cardinality(redirect_uris) >= 1) OR (grant_types = ARRAY['client_credentials'::text])))",
  'client_oidc_config.client_oidc_config_refresh_token_ttl_floor':
    'CHECK ((refresh_token_ttl_seconds >= 1))',
  'clients.clients_secret_matches_type':
    "CHECK ((((type = 'confidential'::text) AND (secret_hash IS NOT NULL)) OR ((type = 'public'::text) AND (secret_hash IS NULL))))",
  'clients.clients_type_check':
    "CHECK ((type = ANY (ARRAY['public'::text, 'confidential'::text])))",
  'signing_keys.signing_keys_alg_check':
    "CHECK ((alg = ANY (ARRAY['RS256'::text, 'ES256'::text])))",
  'signing_keys.signing_keys_status_check':
    "CHECK ((status = ANY (ARRAY['active'::text, 'rotating'::text, 'retired'::text])))",
  'subjects.subjects_type_check':
    "CHECK ((type = ANY (ARRAY['user'::text, 'service'::text, 'agent_instance'::text])))",
  'user_credentials.user_credentials_type_check': "CHECK ((type = 'password'::text))",
  'users.users_email_addr_spec':
    "CHECK (((email IS NULL) OR ((length(email) <= 254) AND ((strpos(email, '@'::text) - 1) <= 64) AND (email ~ '^[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+(\\.[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'::text))))",
};

interface ColumnRow {
  table_name: string;
  column_name: string;
  sql_type: string;
  not_null: boolean;
  has_default: boolean;
}

interface CheckRow {
  table_name: string;
  constraint_name: string;
  expression: string;
}

interface DeclaredTable {
  name: string;
  file: string;
  columns: Map<string, string>;
}

function schemaFiles(): string[] {
  const files: string[] = [];
  const packagesDir = path.join(REPO_ROOT, 'packages');
  for (const pkg of readdirSync(packagesDir)) {
    const schemaDir = path.join(packagesDir, pkg, 'src', 'schema');
    let entries: string[];
    try {
      entries = readdirSync(schemaDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith('.ts') && entry !== 'index.ts' && !entry.endsWith('.test.ts')) {
        files.push(path.join(schemaDir, entry));
      }
    }
  }
  return files.sort();
}

// `${type} NOT NULL` and `${type} NULL`, plus ` DEFAULT` when the column
// declares one — one comparable string per column, so a mismatch reports
// what differs rather than just that something does.
function describeColumn(sqlType: string, notNull: boolean, hasDefault: boolean): string {
  return `${sqlType} ${notNull ? 'NOT NULL' : 'NULL'}${hasDefault ? ' DEFAULT' : ''}`;
}

async function declaredTables(): Promise<DeclaredTable[]> {
  const declared: DeclaredTable[] = [];
  // One table object reached through both its own module and a re-export
  // (schema/index.ts) is one declaration, not two; identity is what tells
  // that apart from two modules each declaring pgTable('realms', ...).
  const seen = new Set<PgTable>();
  for (const file of schemaFiles()) {
    const module: unknown = await import(pathToFileURL(file).href);
    for (const exported of Object.values(module as Record<string, unknown>)) {
      if (!is(exported, PgTable)) continue;
      if (seen.has(exported)) continue;
      seen.add(exported);
      const config = getTableConfig(exported);
      declared.push({
        name: config.name,
        file: path.relative(REPO_ROOT, file),
        columns: new Map(
          config.columns.map((column) => [
            column.name,
            describeColumn(column.getSQLType(), column.notNull, column.hasDefault),
          ]),
        ),
      });
    }
  }
  return declared;
}

let containerHandle: TestDatabase | undefined;
let dbHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let handle: DatabaseHandle;

let declared: DeclaredTable[];
let columns: ColumnRow[];

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  dbHandle = createDatabase(container.adminUrl);
  handle = dbHandle;
  await runMigrations(handle.db, MIGRATIONS_DIR);

  declared = await declaredTables();
  columns = await handle.sql<ColumnRow[]>`
    select c.relname                                as table_name,
           a.attname                                as column_name,
           format_type(a.atttypid, a.atttypmod)     as sql_type,
           a.attnotnull                             as not_null,
           a.atthasdef                              as has_default
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where n.nspname = 'public' and c.relkind in ('r', 'p')
     order by c.relname, a.attname
  `;
}, 120_000);

afterAll(async () => {
  await dbHandle?.close();
  await containerHandle?.stop();
});

describe('TypeScript schema against the migrated database', () => {
  it('declares every migrated table exactly once, and declares no table that was never migrated', () => {
    const migrated = new Set(
      columns.map((row) => row.table_name).filter((name) => !UNDECLARED_TABLES.has(name)),
    );
    expect(migrated.size).toBeGreaterThan(0);

    const declaredNames = declared.map((table) => table.name);
    const duplicates = declaredNames.filter((name, i) => declaredNames.indexOf(name) !== i);
    expect(duplicates, 'two pgTable declarations name the same table').toEqual([]);

    expect([...declaredNames].sort()).toEqual([...migrated].sort());
  });

  it('declares every column of every table with the migrated type, nullability and default', () => {
    const byTable = new Map(declared.map((table) => [table.name, table]));

    for (const table of declared) {
      const migratedColumns = columns.filter((row) => row.table_name === table.name);
      // A declaration naming a table no migration created has no columns to
      // compare against; the test above is what reports it.
      if (migratedColumns.length === 0) continue;

      const fromDatabase = Object.fromEntries(
        migratedColumns.map((row) => [
          row.column_name,
          describeColumn(row.sql_type, row.not_null, row.has_default),
        ]),
      );
      const fromTypeScript = Object.fromEntries([...table.columns].sort());

      expect.soft(fromTypeScript, `${table.file} declares ${table.name}`).toEqual(fromDatabase);
    }

    expect(byTable.size).toBeGreaterThan(0);
  });

  it('accounts for every CHECK constraint the migrations add', async () => {
    const checks = await handle.sql<CheckRow[]>`
      select c.relname                     as table_name,
             con.conname                   as constraint_name,
             pg_get_constraintdef(con.oid) as expression
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and con.contype = 'c'
       order by c.relname, con.conname
    `;

    const fromDatabase = Object.fromEntries(
      checks.map((row) => [`${row.table_name}.${row.constraint_name}`, row.expression]),
    );

    expect(fromDatabase).toEqual(EXPECTED_CHECKS);
  });
});
