import { OduduError } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { type Database } from '#/client.js';

export async function withRealm<T>(
  db: Database,
  realmId: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  if (realmId.length === 0) {
    throw new OduduError('realm_context_missing', 'withRealm requires a realm id');
  }

  return db.transaction(async (tx) => {
    // set_config(..., true) is the bindable form of SET LOCAL; SET LOCAL itself
    // takes no parameters, and interpolating realmId into DDL would be injectable.
    await tx.execute(sql`select set_config('app.realm_id', ${realmId}, true)`);
    return fn(tx);
  });
}
