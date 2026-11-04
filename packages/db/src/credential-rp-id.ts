import { sql } from 'drizzle-orm';
import { type Database } from '#/client';

// The passkeys registered before a credential recorded its relying-party id
// were all registered at the base host, so they take that host's id. Run on
// the owner connection, which row-level security does not scope: the rows of
// every tenant are one deployment's. Served by
// user_credentials_unstamped_passkeys, so a start with nothing to stamp
// reads no credential.
export async function stampPasskeyRelyingParty(db: Database, rpId: string): Promise<number> {
  const result = await db.execute(sql`
    UPDATE user_credentials
       SET rp_id = ${rpId}
     WHERE type = 'webauthn' AND rp_id IS NULL
  `);
  return result.count;
}
