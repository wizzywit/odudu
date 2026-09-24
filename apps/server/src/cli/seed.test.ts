import { describe, expect, it } from 'vitest';
import { refuseSystemTenantName, seed } from '#/cli/seed';

// These assertions all happen before the seed command opens a database
// connection, so they need no Postgres — packages/db's Testcontainers
// setup covers the create/idempotency/conflict behaviour once a tenant id
// is in play (apps/server/tests/seed.int.test.ts).
describe('seed option validation', () => {
  it('refuses a redirect URI that is not absolute', async () => {
    await expect(
      seed({
        tenant: 'acme',
        clientId: 'web-app',
        redirectUris: ['/callback'],
      }),
    ).rejects.toThrow(/absolute/);
  });

  it('refuses the reserved system tenant name, the same as seed tenant', async () => {
    // `resolveTenantId` would otherwise create `system` under a random id,
    // and `seed admin` — which keys that tenant on a fixed id — then
    // refuses to run at all.
    await expect(
      seed({
        tenant: 'system',
        clientId: 'web-app',
        redirectUris: ['https://app.example/callback'],
      }),
    ).rejects.toThrow(/reserved/);
  });

  it('refuses a username given without a password', async () => {
    await expect(
      seed({
        tenant: 'acme',
        clientId: 'web-app',
        redirectUris: ['https://app.example/callback'],
        username: 'ada',
      }),
    ).rejects.toThrow(/together/);
  });

  it('refuses a password given without a username', async () => {
    await expect(
      seed({
        tenant: 'acme',
        clientId: 'web-app',
        redirectUris: ['https://app.example/callback'],
        password: 'pw',
      }),
    ).rejects.toThrow(/together/);
  });

  it('refuses an email with nobody to attach it to', async () => {
    await expect(
      seed({
        tenant: 'acme',
        clientId: 'web-app',
        redirectUris: ['https://app.example/callback'],
        email: 'ada@example.com',
      }),
    ).rejects.toThrow(/email/);
  });

  it('refuses sendVerificationEmail with no address to send to', async () => {
    await expect(
      seed({
        tenant: 'acme',
        clientId: 'web-app',
        redirectUris: ['https://app.example/callback'],
        username: 'ada',
        password: 'pw',
        sendVerificationEmail: true,
      }),
    ).rejects.toThrow(/sendVerificationEmail/);
  });
});

describe('seed tenant', () => {
  it('refuses the reserved system tenant name, the same as the admin API', () => {
    expect(() => {
      refuseSystemTenantName('system');
    }).toThrow(/reserved/);
    expect(() => {
      refuseSystemTenantName('acme');
    }).not.toThrow();
  });
});
