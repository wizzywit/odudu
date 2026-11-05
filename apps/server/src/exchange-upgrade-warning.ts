import { type ExchangeUpgradeFinding } from '@odudu/protocol-oidc';

export function exchangeUpgradeMessage(finding: ExchangeUpgradeFinding): string | null {
  if (finding.count === 0) return null;
  const named = finding.sample.map((entry) => `${entry.tenant}/${entry.clientId}`).join(', ');
  return (
    `${String(finding.count)} public clients hold the token-exchange grant and are refused it ` +
    `until their token_exchange_allowed_for_public is on (first ${String(finding.sample.length)}: ${named})`
  );
}

const READ_TIMEOUT_MS = 5_000;

// The upgrade that bounded token exchange stopped these clients without any
// request failing here first. A read that fails or outlasts `timeoutMs` is
// logged and never stops the server from starting.
export async function warnOfStrandedPublicClients(
  find: () => Promise<ExchangeUpgradeFinding>,
  logger: { warn(details: Record<string, unknown>, message: string): void },
  timeoutMs = READ_TIMEOUT_MS,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const slow = new Promise<'slow'>((resolve) => {
    timer = setTimeout(() => {
      resolve('slow');
    }, timeoutMs);
  });
  try {
    const found = await Promise.race([find(), slow]);
    if (found === 'slow') {
      logger.warn(
        {},
        'the check for public clients the token-exchange limits stopped did not finish',
      );
      return;
    }
    const message = exchangeUpgradeMessage(found);
    if (message !== null) logger.warn({}, message);
  } catch (err) {
    logger.warn({ err }, 'could not check for public clients the token-exchange limits stopped');
  } finally {
    clearTimeout(timer);
  }
}
