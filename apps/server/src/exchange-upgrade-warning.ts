import { EXCHANGE_UPGRADE_COUNT_CAP, type ExchangeUpgradeFinding } from '@odudu/protocol-oidc';
import { warnFromBoundedRead, type BootLogger } from '#/boot-warning';

export function exchangeUpgradeMessage(finding: ExchangeUpgradeFinding): string | null {
  if (finding.count === 0) return null;
  const named = finding.sample.map((entry) => `${entry.tenant}/${entry.clientId}`).join(', ');
  return (
    `${finding.count >= EXCHANGE_UPGRADE_COUNT_CAP ? 'at least ' : ''}${String(finding.count)} public clients hold the token-exchange grant and are refused it ` +
    `until their token_exchange_allowed_for_public is on (first ${String(finding.sample.length)}: ${named})`
  );
}

// The upgrade that bounded token exchange stopped these clients without any
// request failing here first.
export function warnOfStrandedPublicClients(
  find: () => Promise<ExchangeUpgradeFinding>,
  logger: BootLogger,
  timeoutMs?: number,
): Promise<void> {
  return warnFromBoundedRead(
    find,
    exchangeUpgradeMessage,
    logger,
    {
      slow: 'the check for public clients the token-exchange limits stopped did not finish',
      failed: 'could not check for public clients the token-exchange limits stopped',
    },
    timeoutMs,
  );
}
