import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateClientKey } from '@odudu/crypto';
import { type DatabaseHandle } from '@odudu/db';
import { inertDatabase } from '@odudu/db/testing';
import { loadConfig } from '@odudu/kernel';
import { type FastifyInstance, type RouteOptions } from 'fastify';
import { buildApp } from '#/app';
import { loadConsoleKeys } from '#/console-key';
import { type ServedEndpoint } from '#/endpoint-docs';
import { createLogger } from '#/logger';

// Nothing here reaches the database: the app is built only so Fastify's own
// router can be asked what it serves.
const database: DatabaseHandle = {
  db: inertDatabase(),
  sql: Object.assign(() => Promise.resolve([]), {
    options: { max: 1 },
  }) as unknown as DatabaseHandle['sql'],
  close: () => Promise.resolve(),
};

// The app as a deployment with everything on serves it: the console gateway,
// the stylesheet routes and the documentation are registered only when their
// inputs exist, so a probe base address, a generated console key and
// directories holding a stylesheet and a built site stand in for them.
// Nothing here is ever contacted.
export async function servingApp(): Promise<{
  readonly app: FastifyInstance;
  readonly endpoints: readonly ServedEndpoint[];
}> {
  const endpoints: ServedEndpoint[] = [];
  const instrumentDir = mkdtempSync(path.join(tmpdir(), 'odudu-instrument-'));
  writeFileSync(path.join(instrumentDir, 'instrument.css'), '');
  const docsDir = mkdtempSync(path.join(tmpdir(), 'odudu-docs-'));
  writeFileSync(path.join(docsDir, 'index.html'), '');
  writeFileSync(
    path.join(docsDir, 'csp.json'),
    JSON.stringify({ scriptHashes: [], styleAttributeHashes: [] }),
  );
  const config = loadConfig({
    ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu',
    ODUDU_KEK: Buffer.alloc(32, 9).toString('base64'),
    ODUDU_LOG_LEVEL: 'silent',
    ODUDU_PUBLIC_BASE_URL: 'http://localhost:3000',
    ODUDU_CONSOLE_CLIENT_KEY: await generateClientKey(),
  });
  const app = buildApp({
    tls: false,
    database,
    ownerDatabase: database,
    kek: config.ODUDU_KEK,
    logger: createLogger(config),
    instrumentDir,
    docsDir,
    consoleBaseUrl: 'http://localhost:3000',
    consoleKeys: await loadConsoleKeys(config),
    onRoute: (route: RouteOptions) => {
      for (const method of [route.method].flat()) {
        // Fastify adds a HEAD route beside every GET; a client does not call it for itself.
        if (method !== 'HEAD') endpoints.push({ method, url: route.url });
      }
    },
  });
  await app.ready();
  return { app, endpoints };
}
