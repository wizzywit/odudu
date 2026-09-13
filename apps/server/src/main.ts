import { parseArgs } from 'node:util';
import { createDatabase } from '@odudu/db';
import { loadConfig, ModuleRegistry, systemClock } from '@odudu/kernel';
import closeWithGrace from 'close-with-grace';
import { buildApp } from '#/app';
import { type SeedOptions, seed } from '#/cli/seed';
import {
  assertProductionAppDatabaseUrl,
  assertProductionTls,
  warnIfTlsDisabled,
} from '#/config-guard';
import { createLogger } from '#/logger';
import { databaseModule } from '#/modules/database';
import { httpModule } from '#/modules/http';

// --client-secret and --password land in process listings (ps) and shell
// history, since both are plain command-line flags. Acceptable for a local
// bootstrap tool run by an operator who already controls the machine, but
// not something to carry over if this ever grows a networked or CI-invoked
// mode.
function parseSeedOptions(argv: string[]): SeedOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      realm: { type: 'string' },
      client: { type: 'string' },
      'client-secret': { type: 'string' },
      'token-endpoint-auth-method': { type: 'string' },
      'redirect-uri': { type: 'string', multiple: true },
      user: { type: 'string' },
      password: { type: 'string' },
      email: { type: 'string' },
    },
  });

  if (values.realm === undefined || values.client === undefined) {
    throw new Error('seed requires --realm and --client');
  }

  const authMethod = values['token-endpoint-auth-method'];
  if (
    authMethod !== undefined &&
    authMethod !== 'client_secret_basic' &&
    authMethod !== 'client_secret_post'
  ) {
    throw new Error(
      '--token-endpoint-auth-method must be client_secret_basic or client_secret_post',
    );
  }

  return {
    realm: values.realm,
    clientId: values.client,
    redirectUris: values['redirect-uri'] ?? [],
    ...(values['client-secret'] !== undefined ? { clientSecret: values['client-secret'] } : {}),
    ...(authMethod !== undefined ? { tokenEndpointAuthMethod: authMethod } : {}),
    ...(values.user !== undefined ? { username: values.user } : {}),
    ...(values.password !== undefined ? { password: values.password } : {}),
    ...(values.email !== undefined ? { email: values.email } : {}),
  };
}

if (process.argv[2] === 'seed') {
  const result = await seed(parseSeedOptions(process.argv.slice(3)));
  console.log(JSON.stringify(result));
  process.exit(0);
}

const config = loadConfig();
const logger = createLogger(config);

assertProductionAppDatabaseUrl(config);
assertProductionTls(config);
warnIfTlsDisabled(config, (message) => {
  logger.warn({}, message);
});

const owner = createDatabase(config.ODUDU_DATABASE_URL);
const runtime = config.ODUDU_APP_DATABASE_URL
  ? createDatabase(config.ODUDU_APP_DATABASE_URL)
  : owner;

if (runtime === owner) {
  logger.warn({}, 'ODUDU_APP_DATABASE_URL is unset; serving as the owner role bypasses RLS');
}

const app = buildApp({
  database: runtime,
  ownerDatabase: owner,
  kek: config.ODUDU_KEK,
  logger,
  trustProxy: config.ODUDU_TRUST_PROXY,
});

const registry = new ModuleRegistry()
  .register(databaseModule(owner, runtime))
  .register(httpModule(app));

closeWithGrace({ delay: 10_000 }, async ({ err }) => {
  if (err) logger.error({ err }, 'shutting down after an unhandled error');
  await registry.stop();
});

await registry.start({ config, clock: systemClock, logger });
logger.info({ port: config.ODUDU_HTTP_PORT }, 'odudu is listening');
