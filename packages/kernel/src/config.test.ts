import { describe, expect, it } from 'vitest';
import { loadConfig } from '#/config.js';
import { OduduError } from '#/errors.js';

const minimal = { ODUDU_DATABASE_URL: 'postgres://user:pw@localhost:5432/odudu' };

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
});
