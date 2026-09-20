import { createDatabase } from '@odudu/db';
import { loadConfig, ModuleRegistry, systemClock } from '@odudu/kernel';
import closeWithGrace from 'close-with-grace';
import { buildApp } from '#/app';
import { reapCommand } from '#/cli/reap';
import { sendLogoutsCommand } from '#/cli/send-logouts';
import { sendMailCommand } from '#/cli/send-mail';
import { seed } from '#/cli/seed';
import { resolveSeedInvocation } from '#/cli/seed-invocation';
import {
  assertProductionAppDatabaseUrl,
  assertProductionNoPrivateClientUrls,
  assertProductionPasskeyRelyingParty,
  assertProductionTls,
  warnIfTlsDisabled,
} from '#/config-guard';
import { buildEmailSender } from '#/email';
import { createLogger } from '#/logger';
import { createLogoutDeliveryTransport } from '#/logout-delivery-transport';
import { databaseModule } from '#/modules/database';
import { httpModule } from '#/modules/http';
import { logoutSenderModule } from '#/modules/logout-sender';
import { outboxModule } from '#/modules/outbox';
import { reapModule } from '#/modules/reap';

if (process.argv[2] === 'reap') {
  try {
    console.log(JSON.stringify(await reapCommand()));
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[2] === 'send-mail') {
  try {
    console.log(JSON.stringify(await sendMailCommand()));
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[2] === 'send-logouts') {
  try {
    console.log(JSON.stringify(await sendLogoutsCommand()));
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

if (process.argv[2] === 'seed') {
  const invocation = resolveSeedInvocation(process.argv.slice(3));
  const result =
    invocation.kind === 'command' ? await seed(invocation.argv) : await seed(invocation.options);
  // An initial access token is a bearer credential a shell is meant to
  // capture (`TOKEN=$(odudu seed registration-token …)`), so it leaves
  // alone on stdout rather than wrapped in the JSON report every other
  // subcommand prints.
  if ('command' in result && result.command === 'registration-token') {
    console.log(result.token);
  } else {
    console.log(JSON.stringify(result));
  }
  process.exit(0);
}

const config = loadConfig();
const logger = createLogger(config);

assertProductionAppDatabaseUrl(config);
assertProductionTls(config);
assertProductionPasskeyRelyingParty(config);
assertProductionNoPrivateClientUrls(config);
warnIfTlsDisabled(config, (message) => {
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

const sender = buildEmailSender(config, logger);

const app = buildApp({
  database: runtime,
  ownerDatabase: owner,
  kek: config.ODUDU_KEK,
  logger,
  ...(config.ODUDU_PUBLIC_BASE_URL !== undefined
    ? { publicBaseUrl: config.ODUDU_PUBLIC_BASE_URL }
    : {}),
  trustProxy: config.ODUDU_TRUST_PROXY,
  throttle: {
    limit: config.ODUDU_THROTTLE_LIMIT,
    windowSeconds: config.ODUDU_THROTTLE_WINDOW_SECONDS,
  },
});

const registry = new ModuleRegistry()
  .register(databaseModule(owner, runtime))
  .register(reapModule({ database: runtime, ownerDatabase: owner }))
  .register(outboxModule({ database: runtime, ownerDatabase: owner, sender }))
  .register(
    logoutSenderModule({
      database: runtime,
      ownerDatabase: owner,
      transport: createLogoutDeliveryTransport(),
    }),
  )
  .register(httpModule(app));

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) logger.error({ err }, 'shutting down after an unhandled error');
  await registry.stop();
});

await registry.start({ config, clock: systemClock, logger });
logger.info({ port: config.ODUDU_HTTP_PORT }, 'odudu is listening');
