import { loadConfig } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { assertProductionAppDatabaseUrl } from '#/config-guard';

const base = {
  ODUDU_DATABASE_URL: 'postgres://user:pw@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 9).toString('base64'),
};

describe('assertProductionAppDatabaseUrl', () => {
  it('throws when NODE_ENV is production and ODUDU_APP_DATABASE_URL is unset', () => {
    const config = loadConfig({ ...base, NODE_ENV: 'production' });
    expect(() => {
      assertProductionAppDatabaseUrl(config);
    }).toThrow(/ODUDU_APP_DATABASE_URL/);
  });

  it('does not throw when NODE_ENV is production and ODUDU_APP_DATABASE_URL is set', () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: 'production',
      ODUDU_APP_DATABASE_URL: 'postgres://svc:pw@localhost:5432/odudu',
    });
    expect(() => {
      assertProductionAppDatabaseUrl(config);
    }).not.toThrow();
  });

  it('does not throw outside production even when ODUDU_APP_DATABASE_URL is unset', () => {
    const config = loadConfig({ ...base, NODE_ENV: 'development' });
    expect(() => {
      assertProductionAppDatabaseUrl(config);
    }).not.toThrow();
  });
});
