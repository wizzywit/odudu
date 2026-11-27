import { type ChatDeps, type StatusDeps } from '@odudu/assistant';
import { type DatabaseHandle } from '@odudu/db';
import { type Config, consoleBaseUrl } from '@odudu/kernel';
import { type Logger as PinoLogger } from 'pino';
import { type AppDeps } from '#/app';
import { type ConsoleKeys } from '#/console-key';
import { throttleSettingsFrom } from '#/throttle-settings';

// What `serve.ts` hands `buildApp`, as one function so a test builds the app
// exactly as the process does. `tls` is the one value every cookie the server
// writes or reads follows (the SSO session and remember-me cookies, the
// sign-in handle, the console's cookies): ODUDU_TLS, and nothing else.
export function appDepsFromConfig(
  config: Config,
  parts: {
    readonly runtime: DatabaseHandle;
    readonly owner: DatabaseHandle;
    readonly logger: PinoLogger;
    readonly consoleKeys: ConsoleKeys | undefined;
    readonly deploymentSmtp: boolean;
    readonly assistant?: StatusDeps;
    readonly assistantModels?: ChatDeps['model'];
  },
): AppDeps {
  return {
    database: parts.runtime,
    ownerDatabase: parts.owner,
    kek: config.ODUDU_KEK,
    logger: parts.logger,
    ...(config.ODUDU_PUBLIC_BASE_URL !== undefined
      ? { publicBaseUrl: config.ODUDU_PUBLIC_BASE_URL }
      : {}),
    consoleBaseUrl: consoleBaseUrl(config),
    consoleKeys: parts.consoleKeys,
    consoleDir: config.ODUDU_CONSOLE_DIR,
    instrumentDir: config.ODUDU_INSTRUMENT_DIR,
    docsDir: config.ODUDU_DOCS ? config.ODUDU_DOCS_DIR : undefined,
    trustProxy: config.ODUDU_TRUST_PROXY,
    tls: config.ODUDU_TLS,
    tlsClientCertHeader: config.ODUDU_TLS_CLIENT_CERT_HEADER,
    ...throttleSettingsFrom(config),
    allowPrivateClientUrls: config.ODUDU_ALLOW_PRIVATE_CLIENT_URLS,
    allowPrivateSmtpHosts: config.ODUDU_ALLOW_PRIVATE_SMTP_HOSTS,
    deploymentSmtp: parts.deploymentSmtp,
    outboxMaxAttempts: config.ODUDU_OUTBOX_MAX_ATTEMPTS,
    ...(parts.assistant === undefined ? {} : { assistant: parts.assistant }),
    ...(parts.assistantModels === undefined ? {} : { assistantModels: parts.assistantModels }),
  };
}
