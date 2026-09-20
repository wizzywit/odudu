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

  it('schedules the retention pass hourly by default', () => {
    const config = loadConfig(minimal);
    expect(config.ODUDU_REAP_ENABLED).toBe(true);
    expect(config.ODUDU_REAP_INTERVAL_SECONDS).toBe(3600);
  });

  // The one variable in this file whose absence means "on". An operator
  // scheduling `odudu reap` externally has to be able to say so, and a
  // deployment that says nothing must still reap.
  it('turns the retention schedule off only on the literal string false', () => {
    expect(loadConfig({ ...minimal, ODUDU_REAP_ENABLED: 'false' }).ODUDU_REAP_ENABLED).toBe(false);
    expect(loadConfig({ ...minimal, ODUDU_REAP_ENABLED: 'true' }).ODUDU_REAP_ENABLED).toBe(true);
    expect(() => loadConfig({ ...minimal, ODUDU_REAP_ENABLED: 'no' })).toThrow(/REAP_ENABLED/u);
  });

  it('reads a shortened retention interval out of the environment', () => {
    expect(
      loadConfig({ ...minimal, ODUDU_REAP_INTERVAL_SECONDS: '900' }).ODUDU_REAP_INTERVAL_SECONDS,
    ).toBe(900);
  });

  it('refuses a retention interval of zero rather than reading it as off', () => {
    expect(() => loadConfig({ ...minimal, ODUDU_REAP_INTERVAL_SECONDS: '0' })).toThrow(
      /REAP_INTERVAL_SECONDS/u,
    );
  });

  it('sends queued mail every fifteen seconds by default', () => {
    const config = loadConfig(minimal);
    expect(config.ODUDU_OUTBOX_ENABLED).toBe(true);
    expect(config.ODUDU_OUTBOX_INTERVAL_SECONDS).toBe(15);
    expect(config.ODUDU_OUTBOX_BATCH_SIZE).toBe(20);
    expect(config.ODUDU_OUTBOX_MAX_ATTEMPTS).toBe(5);
    expect(config.ODUDU_OUTBOX_RETRY_BACKOFF_SECONDS).toBe(60);
  });

  // The other variable whose absence means "on", and for the same reason:
  // a deployment that says nothing must still send its mail.
  it('turns the outbox schedule off only on the literal string false', () => {
    expect(loadConfig({ ...minimal, ODUDU_OUTBOX_ENABLED: 'false' }).ODUDU_OUTBOX_ENABLED).toBe(
      false,
    );
    expect(() => loadConfig({ ...minimal, ODUDU_OUTBOX_ENABLED: 'no' })).toThrow(/OUTBOX_ENABLED/u);
  });

  it('refuses an attempt ceiling of zero, which would send nothing at all', () => {
    expect(() => loadConfig({ ...minimal, ODUDU_OUTBOX_MAX_ATTEMPTS: '0' })).toThrow(
      /OUTBOX_MAX_ATTEMPTS/u,
    );
  });

  it('delivers back-channel logouts every fifteen seconds by default', () => {
    const config = loadConfig(minimal);
    expect(config.ODUDU_LOGOUT_SENDER_ENABLED).toBe(true);
    expect(config.ODUDU_LOGOUT_SENDER_INTERVAL_SECONDS).toBe(15);
    expect(config.ODUDU_LOGOUT_SENDER_BATCH_SIZE).toBe(20);
    expect(config.ODUDU_LOGOUT_SENDER_LEASE_SECONDS).toBe(30);
    expect(config.ODUDU_LOGOUT_SENDER_RESPONSE_TIMEOUT_MS).toBe(5000);
  });

  // The third variable whose absence means "on": a deployment that says
  // nothing must still tell relying parties a session ended.
  it('turns the logout-sender schedule off only on the literal string false', () => {
    expect(
      loadConfig({ ...minimal, ODUDU_LOGOUT_SENDER_ENABLED: 'false' }).ODUDU_LOGOUT_SENDER_ENABLED,
    ).toBe(false);
    expect(() => loadConfig({ ...minimal, ODUDU_LOGOUT_SENDER_ENABLED: 'no' })).toThrow(
      /LOGOUT_SENDER_ENABLED/u,
    );
  });

  it('refuses a logout-sender interval of zero rather than reading it as off', () => {
    expect(() => loadConfig({ ...minimal, ODUDU_LOGOUT_SENDER_INTERVAL_SECONDS: '0' })).toThrow(
      /LOGOUT_SENDER_INTERVAL_SECONDS/u,
    );
  });

  it('keeps a delivered message a week and a spent one thirty days', () => {
    const config = loadConfig(minimal);
    expect(config.ODUDU_RETENTION_EMAIL_SENT_SECONDS).toBe(604_800);
    expect(config.ODUDU_RETENTION_EMAIL_FAILED_SECONDS).toBe(2_592_000);
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
