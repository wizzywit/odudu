import { describe, expect, it } from 'vitest';
import { seed } from '#/cli/seed';

// These assertions all happen before the seed command opens a database
// connection, so they need no Postgres — packages/db's Testcontainers
// setup covers the create/idempotency/conflict behaviour once a realm id
// is in play (apps/server/tests/seed.int.test.ts).
describe('seed option validation', () => {
  it('refuses a redirect URI that is not absolute', async () => {
    await expect(
      seed({
        realm: 'acme',
        clientId: 'web-app',
        redirectUris: ['/callback'],
      }),
    ).rejects.toThrow(/absolute/);
  });

  it('refuses a username given without a password', async () => {
    await expect(
      seed({
        realm: 'acme',
        clientId: 'web-app',
        redirectUris: ['https://app.example/callback'],
        username: 'ada',
      }),
    ).rejects.toThrow(/together/);
  });

  it('refuses a password given without a username', async () => {
    await expect(
      seed({
        realm: 'acme',
        clientId: 'web-app',
        redirectUris: ['https://app.example/callback'],
        password: 'pw',
      }),
    ).rejects.toThrow(/together/);
  });

  it('refuses an email with nobody to attach it to', async () => {
    await expect(
      seed({
        realm: 'acme',
        clientId: 'web-app',
        redirectUris: ['https://app.example/callback'],
        email: 'ada@example.com',
      }),
    ).rejects.toThrow(/email/);
  });
});
