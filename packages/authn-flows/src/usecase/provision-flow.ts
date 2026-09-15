import { type RealmScopedDatabase } from '@odudu/db';
import { provisionRealmDefaults } from '@odudu/domain-realm';
import { executionRepository } from '#/repository/executions';
import { type Requirement } from '#/schema/execution';

interface DefaultExecution {
  authenticator: string;
  requirement: Requirement;
}

// A passkey or a password gets a subject through the first group; the OTP
// step's own applicability — enrolled, or the realm demands it, and never
// after a passkey, which is already two factors — is decided by the
// evaluator, not by this list.
export const BROWSER_FLOW_DEFAULT: readonly DefaultExecution[] = [
  { authenticator: 'passkey', requirement: 'alternative' },
  { authenticator: 'password', requirement: 'alternative' },
  { authenticator: 'otp', requirement: 'conditional' },
];

// Seeds the browser flow alone. Exported so a caller that wants only the
// scope vocabulary, or that cannot depend on this package (domain-realm
// itself, underneath it), can still reach for provisionRealmDefaults
// without carrying a flow it does not want.
export async function provisionBrowserFlow(
  tx: RealmScopedDatabase,
  realmId: string,
): Promise<void> {
  const repository = executionRepository(tx);
  for (const [index, execution] of BROWSER_FLOW_DEFAULT.entries()) {
    await repository.create({ realmId, index, ...execution });
  }
}

// A realm is not usable until it has both a scope vocabulary and a flow to
// authenticate against — provisionRealmDefaults (@odudu/domain-realm) gives
// the first, provisionBrowserFlow the second. This is the one function that
// calls both, so a realm-creation site cannot drift into calling only one of
// them; every caller standing up a real realm should reach for this rather
// than the two pieces separately.
export async function provisionRealm(tx: RealmScopedDatabase, realmId: string): Promise<void> {
  await provisionRealmDefaults(tx, realmId);
  await provisionBrowserFlow(tx, realmId);
}
