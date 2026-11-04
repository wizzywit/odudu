import { createDatabase } from '@odudu/db';
import { loadConfig, ModuleRegistry, systemClock } from '@odudu/kernel';
import closeWithGrace from 'close-with-grace';
import { buildApp } from '#/app';
import { appDepsFromConfig } from '#/app-deps';
import {
  assertConsoleConfigured,
  assertProductionAppDatabaseUrl,
  assertProductionKekNotExample,
  assertProductionNoPrivateClientUrls,
  assertProductionPasskeyRelyingParty,
  assertProductionTls,
  warnIfConsoleCookieFallback,
  warnIfTlsDisabled,
} from '#/config-guard';
import { buildEmailSender, resolveSender, smtpDestinationPolicyFor } from '#/email';
import { loadConsoleKeys } from '#/console-key';
import { createLogger } from '#/logger';
import { createLogoutDeliveryTransport } from '#/logout-delivery-transport';
import { databaseModule } from '#/modules/database';
import { httpModule } from '#/modules/http';
import { logoutSenderModule } from '#/modules/logout-sender';
import { outboxModule } from '#/modules/outbox';
import { domainRecheckModule } from '#/modules/domain-recheck';
import { reapModule } from '#/modules/reap';

const config = loadConfig();
const logger = createLogger(config);

assertProductionAppDatabaseUrl(config);
assertProductionKekNotExample(config);
assertProductionTls(config);
assertProductionPasskeyRelyingParty(config);
assertProductionNoPrivateClientUrls(config);
assertConsoleConfigured(config);
const consoleKeys = await loadConsoleKeys(config);
warnIfTlsDisabled(config, (message) => {
  logger.warn({}, message);
});
warnIfConsoleCookieFallback(config, (message) => {
  logger.warn({}, message);
});

const owner = createDatabase(config.ODUDU_DATABASE_URL);
const runtime = config.ODUDU_APP_DATABASE_URL
  ? createDatabase(config.ODUDU_APP_DATABASE_URL)
  : owner;

if (runtime === owner) {
  logger.warn(
    {},
    'ODUDU_APP_DATABASE_URL is unset; serving as the owner role, which can switch ' +
      'row-level security off and escapes it outright where that role is a superuser',
  );
}

const emailFallback = buildEmailSender(config, logger);

const app = buildApp(
  appDepsFromConfig(config, {
    runtime,
    owner,
    logger,
    consoleKeys,
    deploymentSmtp: emailFallback.kind === 'smtp',
  }),
);

const smtpDestination = smtpDestinationPolicyFor(config);

const registry = new ModuleRegistry()
  .register(databaseModule(owner, runtime))
  .register(reapModule({ database: runtime, ownerDatabase: owner }))
  .register(domainRecheckModule({ database: runtime, ownerDatabase: owner }))
  .register(
    outboxModule({
      database: runtime,
      ownerDatabase: owner,
      resolveSender: (tenantId) =>
        resolveSender(
          {
            database: runtime.db,
            kek: config.ODUDU_KEK,
            fallback: emailFallback,
            smtpDestination,
          },
          tenantId,
        ),
    }),
  )
  .register(
    logoutSenderModule({
      database: runtime,
      ownerDatabase: owner,
      transport: createLogoutDeliveryTransport({
        allowPrivate: config.ODUDU_ALLOW_PRIVATE_CLIENT_URLS,
      }),
    }),
  )
  .register(httpModule(app));

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) logger.error({ err }, 'shutting down after an unhandled error');
  await registry.stop();
});

await registry.start({ config, clock: systemClock, logger });
logger.info({ port: config.ODUDU_HTTP_PORT }, 'odudu is listening');
