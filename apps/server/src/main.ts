import { createDatabase } from '@odudu/db';
import { loadConfig, ModuleRegistry, systemClock } from '@odudu/kernel';
import closeWithGrace from 'close-with-grace';
import { buildApp } from '#/app';
import { assertProductionAppDatabaseUrl } from '#/config-guard';
import { createLogger } from '#/logger';
import { databaseModule } from '#/modules/database';
import { httpModule } from '#/modules/http';

const config = loadConfig();
const logger = createLogger(config);

assertProductionAppDatabaseUrl(config);

const owner = createDatabase(config.ODUDU_DATABASE_URL);
const runtime = config.ODUDU_APP_DATABASE_URL
  ? createDatabase(config.ODUDU_APP_DATABASE_URL)
  : owner;

if (runtime === owner) {
  logger.warn({}, 'ODUDU_APP_DATABASE_URL is unset; serving as the owner role bypasses RLS');
}

const app = buildApp({ database: runtime, logger, trustProxy: config.ODUDU_TRUST_PROXY });

const registry = new ModuleRegistry()
  .register(databaseModule(owner, runtime))
  .register(httpModule(app));

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) logger.error({ err }, 'shutting down after an unhandled error');
  await registry.stop();
});

await registry.start({ config, clock: systemClock, logger });
logger.info({ port: config.ODUDU_HTTP_PORT }, 'odudu is listening');
