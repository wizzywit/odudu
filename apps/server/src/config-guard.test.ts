import { loadConfig } from '@odudu/kernel';
import { describe, expect, it, vi } from 'vitest';
import {
  assertProductionAppDatabaseUrl,
  assertProductionNoPrivateClientUrls,
  assertProductionPasskeyRelyingParty,
  assertProductionTls,
  warnIfTlsDisabled,
} from '#/config-guard';

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

describe('[RFC6749-3.1-02] assertProductionTls', () => {
  it('throws when NODE_ENV is production and ODUDU_TLS is off', () => {
    const config = loadConfig({ ...base, NODE_ENV: 'production' });
    expect(() => {
      assertProductionTls(config);
    }).toThrow(/ODUDU_TLS/);
  });

  it('throws when NODE_ENV is production and ODUDU_TLS is explicitly false', () => {
    const config = loadConfig({ ...base, NODE_ENV: 'production', ODUDU_TLS: 'false' });
    expect(() => {
      assertProductionTls(config);
    }).toThrow(/ODUDU_TLS/);
  });

  it('does not throw when NODE_ENV is production and ODUDU_TLS is on', () => {
    const config = loadConfig({ ...base, NODE_ENV: 'production', ODUDU_TLS: 'true' });
    expect(() => {
      assertProductionTls(config);
    }).not.toThrow();
  });

  it('does not throw outside production even when ODUDU_TLS is off', () => {
    const config = loadConfig({ ...base, NODE_ENV: 'development' });
    expect(() => {
      assertProductionTls(config);
    }).not.toThrow();
  });
});

describe('assertProductionNoPrivateClientUrls', () => {
  it('throws when NODE_ENV is production and ODUDU_ALLOW_PRIVATE_CLIENT_URLS is on', () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: 'production',
      ODUDU_ALLOW_PRIVATE_CLIENT_URLS: 'true',
    });
    expect(() => {
      assertProductionNoPrivateClientUrls(config);
    }).toThrow(/ODUDU_ALLOW_PRIVATE_CLIENT_URLS/);
  });

  it('does not throw when NODE_ENV is production and it is off', () => {
    const config = loadConfig({ ...base, NODE_ENV: 'production' });
    expect(() => {
      assertProductionNoPrivateClientUrls(config);
    }).not.toThrow();
  });

  it('does not throw outside production even when it is on', () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: 'development',
      ODUDU_ALLOW_PRIVATE_CLIENT_URLS: 'true',
    });
    expect(() => {
      assertProductionNoPrivateClientUrls(config);
    }).not.toThrow();
  });
});

describe('warnIfTlsDisabled', () => {
  it('warns when ODUDU_TLS is off', () => {
    const config = loadConfig({ ...base });
    const log = vi.fn();

    warnIfTlsDisabled(config, log);

    expect(log).toHaveBeenCalledOnce();
  });

  it('does not warn when ODUDU_TLS is on', () => {
    const config = loadConfig({ ...base, ODUDU_TLS: 'true' });
    const log = vi.fn();

    warnIfTlsDisabled(config, log);

    expect(log).not.toHaveBeenCalled();
  });
});

describe('assertProductionPasskeyRelyingParty', () => {
  it('throws when NODE_ENV is production and ODUDU_PUBLIC_BASE_URL is unset', () => {
    const config = loadConfig({ ...base, NODE_ENV: 'production' });
    expect(() => {
      assertProductionPasskeyRelyingParty(config);
    }).toThrow(/ODUDU_PUBLIC_BASE_URL/);
  });

  it('does not throw when a relying party id can be derived', () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: 'production',
      ODUDU_PUBLIC_BASE_URL: 'https://id.example.com',
    });
    expect(() => {
      assertProductionPasskeyRelyingParty(config);
    }).not.toThrow();
  });

  // Not a silent fallback to the request's host: a passkey registered
  // against a guessed domain is one the browser will never offer again.
  it('does not throw outside production even when the base URL is unset', () => {
    const config = loadConfig({ ...base, NODE_ENV: 'development' });
    expect(() => {
      assertProductionPasskeyRelyingParty(config);
    }).not.toThrow();
  });
});
