import { type Database } from '@odudu/db';
import { describe, expect, it } from 'vitest';
import { tenantSettingsRepository } from '#/repository/tenant-settings';

// A database answering one select with one tenant row.
function holding(row: Record<string, unknown>): Database {
  const answer = { from: () => ({ where: () => Promise.resolve([row]) }) };
  return { select: () => answer } as unknown as Database;
}

const ROW = {
  id: 'id',
  name: 'acme',
  displayName: null,
  enabled: true,
  verifyEmail: false,
  verifyEmailTtlSeconds: 60,
  registrationAllowed: true,
  resetPasswordAllowed: false,
  supportedLocales: ['en'],
  defaultLocale: null,
  passwordMinLength: 8,
  passwordRequireDigit: false,
  passwordRequireUppercase: false,
  passwordRequireLowercase: false,
  passwordRequireSpecial: false,
  passwordNotUsername: false,
  passwordNotEmail: false,
  passwordHistoryDepth: 0,
  passwordMaxAgeDays: 0,
};

describe('the registration username mode read from a tenant row', () => {
  it.each(['required', 'optional', 'generated'])('keeps %s', async (mode) => {
    const found = await tenantSettingsRepository(
      holding({ ...ROW, registrationUsername: mode }),
    ).byName('acme');
    expect(found?.registrationUsername).toBe(mode);
  });

  it('falls back to required for a value it does not know', async () => {
    const found = await tenantSettingsRepository(
      holding({ ...ROW, registrationUsername: 'sometimes' }),
    ).byName('acme');
    expect(found?.registrationUsername).toBe('required');
  });
});
