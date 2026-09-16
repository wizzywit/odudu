import { describe, expect, it } from 'vitest';
import { loadConfig } from '#/config';
import { OduduError } from '#/errors';

const VALID_KEK = Buffer.alloc(32, 9).toString('base64');

const minimal = {
  ODUDU_DATABASE_URL: 'postgres://user:pw@localhost:5432/odudu',
  ODUDU_KEK: VALID_KEK,
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(minimal);
    expect(config.ODUDU_HTTP_PORT).toBe(3000);
    expect(config.ODUDU_HTTP_HOST).toBe('0.0.0.0');
    expect(config.ODUDU_LOG_LEVEL).toBe('info');
    expect(config.NODE_ENV).toBe('development');
  });

  it('coerces the port from a string', () => {
    expect(loadConfig({ ...minimal, ODUDU_HTTP_PORT: '8080' }).ODUDU_HTTP_PORT).toBe(8080);
  });

  it('rejects a missing database url', () => {
    expect(() => loadConfig({})).toThrow(OduduError);
  });

  it('names every offending key in the message', () => {
    try {
      loadConfig({ ODUDU_DATABASE_URL: 'not-a-url', ODUDU_HTTP_PORT: '70000' });
      expect.unreachable('loadConfig should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(OduduError);
      const message = (error as OduduError).message;
      expect(message).toContain('ODUDU_DATABASE_URL');
      expect(message).toContain('ODUDU_HTTP_PORT');
    }
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(loadConfig(minimal))).toBe(true);
  });

  it('leaves the migrations directory unset by default', () => {
    expect('ODUDU_MIGRATIONS_DIR' in loadConfig(minimal)).toBe(false);
  });

  it('leaves the application database url unset by default', () => {
    expect('ODUDU_APP_DATABASE_URL' in loadConfig(minimal)).toBe(false);
  });

  it('defaults ODUDU_TRUST_PROXY to false', () => {
    expect(loadConfig(minimal).ODUDU_TRUST_PROXY).toBe(false);
  });

  it('parses ODUDU_TRUST_PROXY=true as true', () => {
    expect(loadConfig({ ...minimal, ODUDU_TRUST_PROXY: 'true' }).ODUDU_TRUST_PROXY).toBe(true);
  });

  it('parses the literal string ODUDU_TRUST_PROXY=false as false', () => {
    expect(loadConfig({ ...minimal, ODUDU_TRUST_PROXY: 'false' }).ODUDU_TRUST_PROXY).toBe(false);
  });

  it('defaults the throttle to ten requests a minute', () => {
    const config = loadConfig(minimal);
    expect(config.ODUDU_THROTTLE_LIMIT).toBe(10);
    expect(config.ODUDU_THROTTLE_WINDOW_SECONDS).toBe(60);
  });

  it('reads a raised throttle out of the environment', () => {
    const config = loadConfig({
      ...minimal,
      ODUDU_THROTTLE_LIMIT: '500',
      ODUDU_THROTTLE_WINDOW_SECONDS: '30',
    });
    expect(config.ODUDU_THROTTLE_LIMIT).toBe(500);
    expect(config.ODUDU_THROTTLE_WINDOW_SECONDS).toBe(30);
  });

  it('refuses a throttle limit of zero rather than reading it as off', () => {
    expect(() => loadConfig({ ...minimal, ODUDU_THROTTLE_LIMIT: '0' })).toThrow(/THROTTLE_LIMIT/u);
  });

  it('decodes ODUDU_KEK from base64 to exactly 32 bytes', () => {
    const config = loadConfig(minimal);
    expect(config.ODUDU_KEK).toBeInstanceOf(Uint8Array);
    expect(config.ODUDU_KEK).toHaveLength(32);
  });

  it('rejects an ODUDU_KEK that does not decode to 32 bytes', () => {
    try {
      loadConfig({ ...minimal, ODUDU_KEK: Buffer.alloc(16, 1).toString('base64') });
      expect.unreachable('loadConfig should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(OduduError);
      const message = (error as OduduError).message;
      expect(message).toContain('ODUDU_KEK');
      expect(message).toContain('32 bytes');
      expect(message).toContain('16');
    }
  });

  it('rejects a missing ODUDU_KEK', () => {
    expect(() => loadConfig({ ODUDU_DATABASE_URL: minimal.ODUDU_DATABASE_URL })).toThrow(
      OduduError,
    );
  });

  it('leaves the SMTP host unset by default', () => {
    expect('ODUDU_SMTP_HOST' in loadConfig(minimal)).toBe(false);
  });

  it('defaults the SMTP port to 587', () => {
    expect(loadConfig(minimal).ODUDU_SMTP_PORT).toBe(587);
  });

  it('defaults ODUDU_SMTP_STARTTLS to false', () => {
    expect(loadConfig(minimal).ODUDU_SMTP_STARTTLS).toBe(false);
  });

  it('accepts a full SMTP configuration', () => {
    const config = loadConfig({
      ...minimal,
      ODUDU_SMTP_HOST: 'smtp.example.test',
      ODUDU_SMTP_PORT: '2525',
      ODUDU_SMTP_FROM: 'odudu@example.test',
      ODUDU_SMTP_USERNAME: 'odudu',
      ODUDU_SMTP_PASSWORD: 'secret',
      ODUDU_SMTP_STARTTLS: 'true',
    });
    expect(config.ODUDU_SMTP_HOST).toBe('smtp.example.test');
    expect(config.ODUDU_SMTP_PORT).toBe(2525);
    expect(config.ODUDU_SMTP_FROM).toBe('odudu@example.test');
    expect(config.ODUDU_SMTP_USERNAME).toBe('odudu');
    expect(config.ODUDU_SMTP_PASSWORD).toBe('secret');
    expect(config.ODUDU_SMTP_STARTTLS).toBe(true);
  });

  it('rejects an SMTP host with no from address', () => {
    try {
      loadConfig({ ...minimal, ODUDU_SMTP_HOST: 'smtp.example.test' });
      expect.unreachable('loadConfig should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(OduduError);
      expect((error as OduduError).message).toContain('ODUDU_SMTP_FROM');
    }
  });

  it('leaves ODUDU_PUBLIC_BASE_URL unset by default', () => {
    expect('ODUDU_PUBLIC_BASE_URL' in loadConfig(minimal)).toBe(false);
  });

  it('accepts an absolute http or https origin', () => {
    expect(
      loadConfig({ ...minimal, ODUDU_PUBLIC_BASE_URL: 'https://idp.example.test' })
        .ODUDU_PUBLIC_BASE_URL,
    ).toBe('https://idp.example.test');
  });

  it('normalizes a trailing slash off the origin', () => {
    expect(
      loadConfig({ ...minimal, ODUDU_PUBLIC_BASE_URL: 'http://localhost:3000/' })
        .ODUDU_PUBLIC_BASE_URL,
    ).toBe('http://localhost:3000');
  });

  it('rejects a value carrying a path, since it is an origin, not a URL', () => {
    expect(() =>
      loadConfig({ ...minimal, ODUDU_PUBLIC_BASE_URL: 'http://localhost:3000/realms/demo' }),
    ).toThrow(OduduError);
  });

  it('rejects a non-http(s) scheme', () => {
    expect(() => loadConfig({ ...minimal, ODUDU_PUBLIC_BASE_URL: 'ftp://localhost:3000' })).toThrow(
      OduduError,
    );
  });

  it('rejects a value that is not a URL at all', () => {
    expect(() => loadConfig({ ...minimal, ODUDU_PUBLIC_BASE_URL: 'not a url' })).toThrow(
      OduduError,
    );
  });
});
