import { type ReservedSql, type Sql } from 'postgres';
import { isUniqueViolation } from '#/sqlstate';

export const EMAIL_UNIQUE_INDEX = 'users_email_search_unique';

export type EmailIndexOutcome = 'present' | 'built' | 'blocked';

// Held across the build so two instances starting together take turns: the
// second finds the index and builds nothing.
const BUILD_LOCK = 5_139_002;

// The unique address index, built when it is missing. The migration that makes
// it skips the build over accounts that differ only by the case of their
// address; this runs at every start, so the first start after
// `odudu reconcile-accounts` has folded them builds it. The pair is looked for
// first with a read, so a deployment that still holds one never starts a build.
// The build is CONCURRENTLY, so writes to `users` go on during it, and an
// interrupted one leaves an invalid index, which is dropped and made again.
// Run on the owner connection: an index build is not scoped by row-level
// security.
export async function ensureUniqueEmailIndex(sql: Sql): Promise<EmailIndexOutcome> {
  const connection = await sql.reserve();
  try {
    await connection`select pg_advisory_lock(${BUILD_LOCK})`;
    try {
      return await buildIfMissing(connection);
    } finally {
      await connection`select pg_advisory_unlock(${BUILD_LOCK})`;
    }
  } finally {
    connection.release();
  }
}

async function buildIfMissing(connection: ReservedSql): Promise<EmailIndexOutcome> {
  const found = await connection<{ valid: boolean }[]>`
    select indisvalid as valid from pg_index where indexrelid = to_regclass(${EMAIL_UNIQUE_INDEX})`;
  if (found[0]?.valid === true) return 'present';
  if (found.length > 0) await connection.unsafe(`DROP INDEX IF EXISTS ${EMAIL_UNIQUE_INDEX}`);
  const pair = await connection`
    select 1 from users where email_search is not null
    group by tenant_id, email_search having count(*) > 1 limit 1`;
  if (pair.length > 0) return 'blocked';
  try {
    await connection.unsafe(
      `CREATE UNIQUE INDEX CONCURRENTLY ${EMAIL_UNIQUE_INDEX} ` +
        'ON users (tenant_id, email_search) WHERE email_search IS NOT NULL',
    );
    return 'built';
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    await connection.unsafe(`DROP INDEX IF EXISTS ${EMAIL_UNIQUE_INDEX}`);
    return 'blocked';
  }
}
