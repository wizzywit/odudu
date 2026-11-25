import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { configSchema, loadConfig, MAX_THROTTLE_LIMIT } from '#/config';
import { CONFIG_DOCS, configReference, REQUIRED_PROBE, type ConfigKey } from '#/config-docs';

// Built inside each test, so a key the loader gained without a summary fails
// the test that names it rather than the whole file.
function rows() {
  return configReference();
}

function row(name: ConfigKey) {
  const found = rows().find((entry) => entry.name === name);
  if (found === undefined) throw new Error(`${name} is not documented`);
  return found;
}

describe('the configuration reference', () => {
  it('documents every key the loader accepts and no other', () => {
    const accepted = Object.keys(
      z.toJSONSchema(configSchema, { io: 'input', unrepresentable: 'any' }).properties ?? {},
    ).sort();
    expect(Object.keys(CONFIG_DOCS).sort()).toEqual(accepted);
    expect(
      rows()
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(accepted);
  });

  it('marks ODUDU_KEK, the SMTP password and the console key secret and prints no default for them', () => {
    for (const name of ['ODUDU_KEK', 'ODUDU_SMTP_PASSWORD', 'ODUDU_CONSOLE_CLIENT_KEY'] as const) {
      expect(row(name).secret, name).toBe(true);
      expect(row(name).default, name).toBeUndefined();
    }
    expect(
      rows()
        .filter((entry) => entry.secret)
        .map((entry) => entry.name)
        .sort(),
    ).toEqual([
      'ODUDU_APP_DATABASE_URL',
      'ODUDU_ASSISTANT_OPENAI_COMPATIBLE_API_KEY',
      'ODUDU_CONSOLE_CLIENT_KEY',
      'ODUDU_CONSOLE_CLIENT_KEY_PREVIOUS',
      'ODUDU_DATABASE_URL',
      'ODUDU_KEK',
      'ODUDU_SMTP_PASSWORD',
    ]);
  });

  it('reads each default from what the loader produces, switches included', () => {
    expect(row('ODUDU_HTTP_PORT').default).toBe('3000');
    expect(row('ODUDU_HTTP_HOST').default).toBe('0.0.0.0');
    expect(row('ODUDU_TRUST_PROXY').default).toBe('false');
    expect(row('ODUDU_OUTBOX_ENABLED').default).toBe('true');
    expect(row('ODUDU_CONSOLE').default).toBe('true');
    expect(row('NODE_ENV').default).toBe('development');
    expect(row('ODUDU_SMTP_PORT').default).toBe('587');
  });

  it('gives a default that, set explicitly, changes nothing', () => {
    const base = loadConfig(REQUIRED_PROBE);
    for (const entry of rows()) {
      if (entry.default === undefined) continue;
      const again = loadConfig({ ...REQUIRED_PROBE, [entry.name]: entry.default });
      expect(again[entry.name], entry.name).toEqual(base[entry.name]);
    }
  });

  it('says which keys are required and which are not', () => {
    const required = rows()
      .filter((entry) => entry.required)
      .map((entry) => entry.name);
    expect(required.sort()).toEqual(['ODUDU_DATABASE_URL', 'ODUDU_KEK']);
    expect(Object.keys(REQUIRED_PROBE).sort()).toEqual(required.sort());
    expect(row('ODUDU_SMTP_HOST').required).toBe(false);
    expect(row('ODUDU_SMTP_HOST').default).toBeUndefined();
  });

  it('reads the bounds and the allowed values from the schema', () => {
    expect(row('ODUDU_HTTP_PORT')).toMatchObject({ kind: 'integer', minimum: 1, maximum: 65535 });
    expect(row('ODUDU_THROTTLE_LIMIT').maximum).toBe(MAX_THROTTLE_LIMIT);
    expect(row('ODUDU_LOG_LEVEL').values).toEqual([
      'fatal',
      'error',
      'warn',
      'info',
      'debug',
      'trace',
      'silent',
    ]);
    expect(row('ODUDU_TRUST_PROXY').kind).toBe('boolean');
    expect(row('ODUDU_DATABASE_URL').kind).toBe('url');
  });

  it('gives every key a one-paragraph summary', () => {
    for (const [name, docs] of Object.entries(CONFIG_DOCS)) {
      expect(docs.summary, name).toMatch(/^\S.*\S$/u);
      expect(docs.summary, name).not.toContain('\n');
      expect(docs.summary.length, name).toBeGreaterThan(20);
    }
  });
});

describe('what the server cannot start without', () => {
  it('names the conditions under which an optional key is required, and only for these keys', () => {
    const conditional = rows()
      .filter((entry) => entry.requiredWhen !== undefined)
      .map((entry) => entry.name)
      .sort();
    expect(conditional).toEqual([
      'ODUDU_APP_DATABASE_URL',
      'ODUDU_CONSOLE_CLIENT_KEY',
      'ODUDU_PUBLIC_BASE_URL',
      'ODUDU_SMTP_FROM',
      'ODUDU_TLS',
    ]);
    expect(row('ODUDU_PUBLIC_BASE_URL').requiredWhen).toContain('console is on');
  });
});
