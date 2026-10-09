import { generateKeyPairSync } from 'node:crypto';

// A suite that seeds under a console base URL needs the console's client key
// (apps/server/src/console-key.ts), and none of them cares which. One is made
// for the run, in memory, rather than committed: a suite that signs with the
// key sets its own.
if (process.env.ODUDU_CONSOLE_CLIENT_KEY === undefined) {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  process.env.ODUDU_CONSOLE_CLIENT_KEY = JSON.stringify(privateKey.export({ format: 'jwk' }));
}
