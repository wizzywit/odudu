import { type RealmScopedDatabase } from '@odudu/db';
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

// Called once per realm, at the point the realm itself is created —
// alongside provisionRealmDefaults (@odudu/domain-realm), never through it:
// authn-flows depends on nothing above it, so the caller that stands up a
// realm is the one that calls both. A realm is never left without a flow to
// authenticate against only because every such caller does.
export async function provisionBrowserFlow(
  tx: RealmScopedDatabase,
  realmId: string,
): Promise<void> {
  const repository = executionRepository(tx);
  for (const [index, execution] of BROWSER_FLOW_DEFAULT.entries()) {
    await repository.create({ realmId, index, ...execution });
  }
}
