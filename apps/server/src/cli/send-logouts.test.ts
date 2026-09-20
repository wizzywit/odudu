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
