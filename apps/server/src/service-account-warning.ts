import { IDLE_ACCOUNT_COUNT_CAP, type IdleAccountFinding } from '@odudu/protocol-oidc';
import { warnFromBoundedRead, type BootLogger } from '#/boot-warning';

export function idleAccountMessage(finding: IdleAccountFinding): string | null {
  if (finding.count === 0) return null;
  const named = finding.sample.map((entry) => `${entry.tenant}/${entry.clientId}`).join(', ');
  return (
    `${finding.count >= IDLE_ACCOUNT_COUNT_CAP ? 'at least ' : ''}${String(finding.count)} confidential clients ` +
    `hold a service account without the client_credentials grant, kept because a token, role or record still names it ` +
    `(first ${String(finding.sample.length)}: ${named}); adding client_credentials to grant_types reuses the account and its roles, ` +
    `and an update that leaves client_credentials out retires it unless that would remove the last administrator`
  );
}

// Reported at start so the accounts the upgrade could not retire are listed
// rather than found later.
export function warnOfIdleServiceAccounts(
  find: () => Promise<IdleAccountFinding>,
  logger: BootLogger,
  timeoutMs?: number,
): Promise<void> {
  return warnFromBoundedRead(
    find,
    idleAccountMessage,
    logger,
    {
      slow: 'the check for idle service accounts did not finish',
      failed: 'could not check for idle service accounts',
    },
    timeoutMs,
  );
}
