import { createDatabase } from '@odudu/db';
import { loadConfig, ModuleRegistry, systemClock } from '@odudu/kernel';
import closeWithGrace from 'close-with-grace';
import { buildApp } from '#/app.js';
import { createLogger } from '#/logger.js';
import { databaseModule } from '#/modules/database.js';
import { httpModule } from '#/modules/http.js';

const config = loadConfig();
const logger = createLogger(config);

const owner = createDatabase(config.ODUDU_DATABASE_URL);
const runtime = config.ODUDU_APP_DATABASE_URL
  ? createDatabase(config.ODUDU_APP_DATABASE_URL)
  : owner;

if (runtime === owner) {
  logger.warn({}, 'ODUDU_APP_DATABASE_URL is unset; serving as the owner role bypasses RLS');
}

const app = buildApp({ database: runtime, logger });

const registry = new ModuleRegistry()
  .register(databaseModule(owner, runtime))
  .register(httpModule(app));

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) logger.error({ err }, 'shutting down after an unhandled error');
  await registry.stop();
});

await registry.start({ config, clock: systemClock, logger });
logger.info({ port: config.ODUDU_HTTP_PORT }, 'odudu is listening');
