import { type ReservedSql, type Sql } from 'postgres';
import { isUniqueViolation } from '#/sqlstate';

export const EMAIL_UNIQUE_INDEX = 'users_email_search_unique';

export type EmailIndexOutcome = 'present' | 'built' | 'blocked' | 'skipped';

// Taken, never waited on in the database: a session blocked in pg_advisory_lock
// holds a snapshot that the build's last phase waits for, which Postgres cannot
// see as a deadlock. A waiter polls instead and holds nothing between polls.
export const EMAIL_INDEX_LOCK = 5_139_002;

export interface EnsureOptions {
  // How long to wait for another instance's build before leaving it to build.
  waitMs?: number;
  pollMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// The unique address index, built when it is missing (the migration skips it
// over a pair; the first start after `odudu reconcile-accounts` builds it).
// A pair is looked for first with a read that stops at the first one, so a
// deployment holding one starts no build. The build is CONCURRENTLY, and an
// interrupted one leaves an invalid index, dropped and made again. Run on the
// owner connection: a build is not scoped by row-level security.
export async function ensureUniqueEmailIndex(
  sql: Sql,
  options: EnsureOptions = {},
): Promise<EmailIndexOutcome> {
  const { waitMs = 120_000, pollMs = 250 } = options;
  const connection = await sql.reserve();
  try {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const [taken] = await connection<{ ok: boolean }[]>`
        select pg_try_advisory_lock(${EMAIL_INDEX_LOCK}) as ok`;
      if (taken?.ok === true) break;
      if (Date.now() >= deadline) return 'skipped';
      await sleep(pollMs);
    }
    try {
      return await buildIfMissing(connection);
    } finally {
      await connection`select pg_advisory_unlock(${EMAIL_INDEX_LOCK})`;
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
