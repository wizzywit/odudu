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
});
