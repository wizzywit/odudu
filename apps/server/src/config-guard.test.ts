import { loadConfig, OduduError } from '@odudu/kernel';
import { describe, expect, it, vi } from 'vitest';
import {
  assertConsoleConfigured,
  assertProductionAppDatabaseUrl,
  assertProductionNoPrivateClientUrls,
  assertProductionPasskeyRelyingParty,
  assertProductionTls,
  warnIfConsoleCookieFallback,
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

const KEY = '{"kty":"EC","crv":"P-256"}';

describe('assertConsoleConfigured', () => {
  it('refuses to start the console without its client key, naming the variable and the switch', () => {
    const config = loadConfig({ ...base, ODUDU_PUBLIC_BASE_URL: 'http://localhost:3000' });
    expect(() => {
      assertConsoleConfigured(config);
    }).toThrow(/ODUDU_CONSOLE_CLIENT_KEY.*ODUDU_CONSOLE=false/su);
  });

  it('refuses to start the console without a base URL, naming the base and the switch', () => {
    const config = loadConfig(base);
    expect(() => {
      assertConsoleConfigured(config);
    }).toThrow(/ODUDU_PUBLIC_BASE_URL.*ODUDU_CONSOLE=false/su);
  });

  it('refuses in development as well as production', () => {
    expect(() => {
      assertConsoleConfigured(loadConfig({ ...base, NODE_ENV: 'production' }));
    }).toThrow(OduduError);
    expect(() => {
      assertConsoleConfigured(loadConfig({ ...base, NODE_ENV: 'development' }));
    }).toThrow(OduduError);
  });

  it('passes with the console off and no base URL', () => {
    const config = loadConfig({ ...base, ODUDU_CONSOLE: 'false' });
    expect(() => {
      assertConsoleConfigured(config);
    }).not.toThrow();
  });

  it('passes with an http base URL and a client key', () => {
    const config = loadConfig({
      ...base,
      ODUDU_PUBLIC_BASE_URL: 'http://localhost:3000',
      ODUDU_CONSOLE_CLIENT_KEY: KEY,
    });
    expect(() => {
      assertConsoleConfigured(config);
    }).not.toThrow();
  });

  // The issuer is built from the request's scheme, and a request the
  // gateway injects in-process never arrives over TLS: only a trusted
  // x-forwarded-proto lets it see the https issuer the browser sees.
  it('refuses an https base URL while ODUDU_TRUST_PROXY is off, naming both', () => {
    const config = loadConfig({ ...base, ODUDU_PUBLIC_BASE_URL: 'https://idp.example.test' });
    expect(() => {
      assertConsoleConfigured(config);
    }).toThrow(
      /ODUDU_TRUST_PROXY.*ODUDU_PUBLIC_BASE_URL|ODUDU_PUBLIC_BASE_URL.*ODUDU_TRUST_PROXY/su,
    );
  });

  it('passes with an https base URL behind a trusted proxy', () => {
    const config = loadConfig({
      ...base,
      ODUDU_PUBLIC_BASE_URL: 'https://idp.example.test',
      ODUDU_TRUST_PROXY: 'true',
      ODUDU_CONSOLE_CLIENT_KEY: KEY,
    });
    expect(() => {
      assertConsoleConfigured(config);
    }).not.toThrow();
  });

  // The console cookie follows the base's scheme, so this pairing would
  // serve it without Secure while every other session cookie keeps it.
  it('refuses ODUDU_TLS=true with an http base URL, naming both', () => {
    const config = loadConfig({
      ...base,
      ODUDU_TLS: 'true',
      ODUDU_PUBLIC_BASE_URL: 'http://idp.example.test',
    });
    expect(() => {
      assertConsoleConfigured(config);
    }).toThrow(OduduError);
    expect(() => {
      assertConsoleConfigured(config);
    }).toThrow(/ODUDU_TLS.*ODUDU_PUBLIC_BASE_URL|ODUDU_PUBLIC_BASE_URL.*ODUDU_TLS/su);
  });

  it('ignores ODUDU_TLS=true with an http base URL when the console is off', () => {
    const config = loadConfig({
      ...base,
      ODUDU_TLS: 'true',
      ODUDU_PUBLIC_BASE_URL: 'http://idp.example.test',
      ODUDU_CONSOLE: 'false',
    });
    expect(() => {
      assertConsoleConfigured(config);
    }).not.toThrow();
  });

  it('does not ask for a client key while the console is off', () => {
    const config = loadConfig({
      ...base,
      ODUDU_PUBLIC_BASE_URL: 'http://localhost:3000',
      ODUDU_CONSOLE: 'false',
    });
    expect(() => {
      assertConsoleConfigured(config);
    }).not.toThrow();
  });

  it('ignores an https base without a trusted proxy when the console is off', () => {
    const config = loadConfig({
      ...base,
      ODUDU_PUBLIC_BASE_URL: 'https://idp.example.test',
      ODUDU_CONSOLE: 'false',
    });
    expect(() => {
      assertConsoleConfigured(config);
    }).not.toThrow();
  });
});

describe('warnIfConsoleCookieFallback', () => {
  it('warns once, naming the cookie, when the console is on with an http base URL', () => {
    const config = loadConfig({ ...base, ODUDU_PUBLIC_BASE_URL: 'http://localhost:3000' });
    const log = vi.fn();

    warnIfConsoleCookieFallback(config, log);

    expect(log).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/odudu-console.*__Host-.*Secure/su));
  });

  it('does not warn with an https base URL', () => {
    const config = loadConfig({
      ...base,
      ODUDU_PUBLIC_BASE_URL: 'https://idp.example.test',
      ODUDU_TRUST_PROXY: 'true',
      ODUDU_TLS: 'true',
    });
    const log = vi.fn();

    warnIfConsoleCookieFallback(config, log);

    expect(log).not.toHaveBeenCalled();
  });

  it('does not warn with the console off', () => {
    const config = loadConfig({
      ...base,
      ODUDU_PUBLIC_BASE_URL: 'http://localhost:3000',
      ODUDU_CONSOLE: 'false',
    });
    const log = vi.fn();

    warnIfConsoleCookieFallback(config, log);

    expect(log).not.toHaveBeenCalled();
  });
});
