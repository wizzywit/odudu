import { createDatabase } from '@odudu/db';
import { sendPending, type SendPendingOptions, type SendPendingOutcome } from '@odudu/email';
import { loadConfig, OduduError, type Config } from '@odudu/kernel';
import { buildEmailSender } from '#/email';
import { createLogger } from '#/logger';

export function outboxOptionsFromConfig(config: Config): SendPendingOptions {
  return {
    batchSize: config.ODUDU_OUTBOX_BATCH_SIZE,
    maxAttempts: config.ODUDU_OUTBOX_MAX_ATTEMPTS,
    retryBackoffSeconds: config.ODUDU_OUTBOX_RETRY_BACKOFF_SECONDS,
  };
}

// Reads its own configuration and opens its own connections, the way `reap`
// and the seed command do, so a scheduler — cron, a Kubernetes Job, or an
// operator at a shell — can invoke it as a one-shot process (ADR 0024).
export async function sendMailCommand(): Promise<SendPendingOutcome> {
  const config = loadConfig();
  const appUrl = config.ODUDU_APP_DATABASE_URL;
  // Demanded in every environment, not only production: the claim is
  // scoped by a policy the owner role escapes, so falling back to the
  // owner would claim every realm's messages under one realm's context and
  // write the results back as that realm's.
  if (appUrl === undefined) {
    throw new OduduError(
      'outbox_requires_app_database_url',
      'odudu send-mail requires ODUDU_APP_DATABASE_URL: it claims under the realm policy, ' +
        'which the owner role the migrations use escapes',
    );
  }

  const logger = createLogger(config);
  const owner = createDatabase(config.ODUDU_DATABASE_URL);
  const runtime = createDatabase(appUrl);

  try {
    return await sendPending(
      {
        database: runtime,
        ownerDatabase: owner,
        sender: buildEmailSender(config, logger),
        log: logger,
      },
      new Date(),
      outboxOptionsFromConfig(config),
    );
  } finally {
    await runtime.close();
    await owner.close();
  }
}
