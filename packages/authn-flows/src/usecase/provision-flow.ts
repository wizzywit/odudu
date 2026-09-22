import { type RealmScopedDatabase } from '@odudu/db';
import { provisionTenantDefaults } from '@odudu/domain-tenant';
import { executionRepository } from '#/repository/executions';
import { type Requirement } from '#/schema/execution';
import { isRegisteredAuthenticator } from '#/usecase/executor';

interface DefaultExecution {
  authenticator: string;
  requirement: Requirement;
}

// A passkey or a password gets a subject through the first group; the OTP
// step's own applicability — enrolled, or the realm demands it, and never
// after a passkey, which is already two factors — is decided by the
// evaluator, not by this list. The recovery-code step is last and is
// applicable only to a submission that actually carries a code, which is
// what lets it substitute for the OTP step without ever competing with it;
// migration 0040 appends it to realms provisioned before it existed.
export const BROWSER_FLOW_DEFAULT: readonly DefaultExecution[] = [
  { authenticator: 'passkey', requirement: 'alternative' },
  { authenticator: 'password', requirement: 'alternative' },
  { authenticator: 'otp', requirement: 'conditional' },
  { authenticator: 'recovery-code', requirement: 'conditional' },
];

// Seeds the browser flow alone. Exported so a caller that wants only the
// scope vocabulary, or that cannot depend on this package (domain-tenant
// itself, underneath it), can still reach for provisionTenantDefaults
// without carrying a flow it does not want.
export async function provisionBrowserFlow(
  tx: RealmScopedDatabase,
  realmId: string,
): Promise<void> {
  const repository = executionRepository(tx);
  for (const [index, execution] of BROWSER_FLOW_DEFAULT.entries()) {
    // An unresolvable authenticator name has to fail here, not the first
    // time somebody tries to log in against the row it produces.
    if (!isRegisteredAuthenticator(execution.authenticator)) {
      throw new Error(`unregistered authenticator '${execution.authenticator}' in browser flow`);
    }
    await repository.create({ realmId, index, ...execution });
  }
}

// A realm is not usable until it has both a scope vocabulary and a flow to
// authenticate against — provisionTenantDefaults (@odudu/domain-tenant) gives
// the first, provisionBrowserFlow the second. This is the one function that
// calls both, so a realm-creation site cannot drift into calling only one of
// them; every caller standing up a real realm should reach for this rather
// than the two pieces separately.
export async function provisionRealm(tx: RealmScopedDatabase, realmId: string): Promise<void> {
  await provisionTenantDefaults(tx, realmId);
  await provisionBrowserFlow(tx, realmId);
}
