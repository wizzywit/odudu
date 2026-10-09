import { generateClientKey, loadClientKey } from '@odudu/crypto';
import { loadConfig } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { consoleProvisioning, loadConsoleKeys } from '#/console-key';

const base = {
  ODUDU_DATABASE_URL: 'postgres://user:pw@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 9).toString('base64'),
  ODUDU_PUBLIC_BASE_URL: 'http://localhost:3000',
};

describe('loadConsoleKeys', () => {
  it('reads nothing while the console is off', async () => {
    const config = loadConfig({ ...base, ODUDU_CONSOLE: 'false' });
    expect(await loadConsoleKeys(config)).toBeUndefined();
  });

  it('reads nothing when there is no base URL to register under', async () => {
    const noBase = { ODUDU_DATABASE_URL: base.ODUDU_DATABASE_URL, ODUDU_KEK: base.ODUDU_KEK };
    expect(await loadConsoleKeys(loadConfig(noBase))).toBeUndefined();
  });

  it('refuses a missing key, naming the variable and the switch', async () => {
    await expect(loadConsoleKeys(loadConfig(base))).rejects.toThrow(
      /ODUDU_CONSOLE_CLIENT_KEY.*ODUDU_CONSOLE=false/su,
    );
  });

  it('refuses a key it cannot read, naming the variable and the reason', async () => {
    const config = loadConfig({ ...base, ODUDU_CONSOLE_CLIENT_KEY: 'nope' });
    await expect(loadConsoleKeys(config)).rejects.toThrow(/ODUDU_CONSOLE_CLIENT_KEY.*not JSON/su);
  });

  it('refuses a previous key it cannot read, naming that variable', async () => {
    const config = loadConfig({
      ...base,
      ODUDU_CONSOLE_CLIENT_KEY: await generateClientKey(),
      ODUDU_CONSOLE_CLIENT_KEY_PREVIOUS: '{"kty":"oct","k":"AAAA"}',
    });
    await expect(loadConsoleKeys(config)).rejects.toThrow(
      /ODUDU_CONSOLE_CLIENT_KEY_PREVIOUS.*P-256/su,
    );
  });

  it('registers the signing key alone when nothing is being replaced', async () => {
    const serialized = await generateClientKey();
    const keys = await loadConsoleKeys(
      loadConfig({ ...base, ODUDU_CONSOLE_CLIENT_KEY: serialized }),
    );
    const key = await loadClientKey(serialized);
    expect(keys?.key.kid).toBe(key.kid);
    expect(keys?.jwks.keys).toEqual([key.publicJwk]);
  });

  it('registers the signing key first and the one it replaces after it', async () => {
    const current = await generateClientKey();
    const previous = await generateClientKey();
    const keys = await loadConsoleKeys(
      loadConfig({
        ...base,
        ODUDU_CONSOLE_CLIENT_KEY: current,
        ODUDU_CONSOLE_CLIENT_KEY_PREVIOUS: previous,
      }),
    );
    expect(keys?.jwks.keys.map((k) => k.kid)).toEqual([
      (await loadClientKey(current)).kid,
      (await loadClientKey(previous)).kid,
    ]);
  });
});

describe('consoleProvisioning', () => {
  it('asks for nothing while the console is off', async () => {
    const config = loadConfig({ ...base, ODUDU_CONSOLE: 'false' });
    expect(await consoleProvisioning(config)).toEqual({});
  });

  it("names the base and the key's public set when the console is on", async () => {
    const serialized = await generateClientKey();
    const provisioning = await consoleProvisioning(
      loadConfig({ ...base, ODUDU_CONSOLE_CLIENT_KEY: serialized }),
    );
    expect(provisioning.consoleBaseUrl).toBe('http://localhost:3000');
    expect(provisioning.consoleClientJwks?.keys).toEqual([
      (await loadClientKey(serialized)).publicJwk,
    ]);
  });
});
