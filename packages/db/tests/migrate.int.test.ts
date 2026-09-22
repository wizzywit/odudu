import { newId } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';
import { tenants } from '#/schema/index';

// Guarded (possibly-undefined) handles for cleanup: beforeAll can throw
// before assignment (Docker down, image pull failure), and afterAll must
// still run without a TypeError obscuring the real cause.
let containerHandle: TestDatabase | undefined;
let dbHandle: DatabaseHandle | undefined;

// Non-optional bindings for the test bodies below, which only ever run
// after beforeAll has succeeded.
let container: TestDatabase;
let handle: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  dbHandle = createDatabase(container.adminUrl);
  handle = dbHandle;
  await runMigrations(handle.db, MIGRATIONS_DIR);
});

afterAll(async () => {
  await dbHandle?.close();
  await containerHandle?.stop();
});

describe('migrations', () => {
  it('creates the tenants table with the expected columns', async () => {
    const rows = await handle.sql<{ column_name: string }[]>`
      select column_name
      from information_schema.columns
      where table_schema = 'public' and table_name = 'tenants'
      order by column_name
    `;

    expect(rows.map((row) => row.column_name)).toEqual([
      'brute_force_failure_reset_seconds',
      'brute_force_lockout_seconds',
      'brute_force_max_failures',
      'brute_force_max_lockout_seconds',
      'client_registration_policy',
      'created_at',
      'display_name',
      'enabled',
      'id',
      'max_clients',
      'max_sessions_per_browser',
      'name',
      'otp_required',
      'password_history_depth',
      'password_max_age_days',
      'password_min_length',
      'password_not_email',
      'password_not_username',
      'password_require_digit',
      'password_require_lowercase',
      'password_require_special',
      'password_require_uppercase',
      'registration_allowed',
      'remember_me_allowed',
      'remember_me_idle_seconds',
      'remember_me_max_seconds',
      'reset_password_allowed',
      'sso_session_idle_seconds',
      'sso_session_max_seconds',
      'verify_email',
    ]);
  });

  it('round-trips a tenant', async () => {
    await handle.db.insert(tenants).values({ id: newId(), name: 'acme' });

    const found = await handle.db.select().from(tenants);

    expect(found).toHaveLength(1);
    expect(found[0]?.name).toBe('acme');
    expect(found[0]?.enabled).toBe(true);
  });

  it('rejects a duplicate tenant name', async () => {
    await expect(
      handle.db.insert(tenants).values({ id: newId(), name: 'acme' }),
    ).rejects.toMatchObject({
      cause: {
        code: '23505',
        constraint_name: 'tenants_name_unique',
      },
    });
  });

  it('is idempotent when run a second time', async () => {
    await expect(runMigrations(handle.db, MIGRATIONS_DIR)).resolves.toBeUndefined();
  });
});
