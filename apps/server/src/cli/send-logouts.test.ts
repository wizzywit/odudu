import { loadConfig } from '@odudu/kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { logoutSenderOptionsFromConfig, sendLogoutsCommand } from '#/cli/send-logouts';

const MINIMAL = {
  ODUDU_DATABASE_URL: 'postgres://localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 7).toString('base64'),
};

describe('the options the pass runs with', () => {
  it('takes batch size, lease and response timeout from the environment', () => {
    const options = logoutSenderOptionsFromConfig(
      loadConfig({
        ...MINIMAL,
        ODUDU_LOGOUT_SENDER_BATCH_SIZE: '7',
        ODUDU_LOGOUT_SENDER_LEASE_SECONDS: '45',
        ODUDU_LOGOUT_SENDER_RESPONSE_TIMEOUT_MS: '2500',
      }),
    );

    expect(options).toEqual({ batchSize: 7, leaseSeconds: 45, responseTimeoutMs: 2500 });
  });
});

describe('the connection the command sends on', () => {
  afterEach(() => {
    delete process.env.ODUDU_DATABASE_URL;
    delete process.env.ODUDU_APP_DATABASE_URL;
    delete process.env.ODUDU_KEK;
  });

  // Demanded in every environment, not only production — see
  // `reapCommand`'s identical test and reasoning.
  it('refuses to send without a serving connection to claim on', async () => {
    process.env.ODUDU_DATABASE_URL = MINIMAL.ODUDU_DATABASE_URL;
    process.env.ODUDU_KEK = MINIMAL.ODUDU_KEK;

    await expect(sendLogoutsCommand()).rejects.toThrow(/ODUDU_APP_DATABASE_URL/u);
  });
});

describe('the private-URL escape hatch in production', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.ODUDU_DATABASE_URL;
    delete process.env.ODUDU_KEK;
    delete process.env.ODUDU_ALLOW_PRIVATE_CLIENT_URLS;
  });

  // Called by `sendLogoutsCommand` itself, not only inherited from
  // `main.ts`'s module-scope sequence: the CLI dispatch that reaches this
  // command exits before that sequence's own guard call ever runs, so
  // this is the only place this refusal can happen for `odudu send-logouts`.
  it('refuses before opening a database connection', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ODUDU_DATABASE_URL = MINIMAL.ODUDU_DATABASE_URL;
    process.env.ODUDU_KEK = MINIMAL.ODUDU_KEK;
    process.env.ODUDU_ALLOW_PRIVATE_CLIENT_URLS = 'true';

    await expect(sendLogoutsCommand()).rejects.toThrow(/ODUDU_ALLOW_PRIVATE_CLIENT_URLS/u);
  });
});
