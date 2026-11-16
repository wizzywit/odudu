import { sql } from 'drizzle-orm';
import { type Database } from '#/client';
import { isUniqueViolation } from '#/sqlstate';

export const EMAIL_UNIQUE_INDEX = 'users_email_search_unique';

export type EmailIndexOutcome = 'present' | 'built' | 'blocked';

// The unique address index, built when it is missing. The migration that makes
// it skips the build over accounts that differ only by the case of their
// address; this runs at every start, so the first start after
// `odudu reconcile-accounts` has folded them builds it. A build that finds a
// pair leaves nothing behind. Run on the owner connection: an index build is
// not scoped by row-level security.
export async function ensureUniqueEmailIndex(db: Database): Promise<EmailIndexOutcome> {
  const found = await db.execute(
    sql`select 1 from pg_indexes where indexname = ${EMAIL_UNIQUE_INDEX}`,
  );
  if (found.length > 0) return 'present';
  try {
    await db.execute(
      sql.raw(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${EMAIL_UNIQUE_INDEX} ` +
          'ON users (tenant_id, email_search) WHERE email_search IS NOT NULL',
      ),
    );
    return 'built';
  } catch (error) {
    if (isUniqueViolation(error)) return 'blocked';
    throw error;
  }
}
