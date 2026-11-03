import type { SmtpConfig } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  passwordHint,
  relayBlocked,
  relayHold,
  relayRequest,
  relayValues,
  type RelayValues,
} from '#/pages/email/services/relay';

const CONFIGURED: SmtpConfig = {
  configured: true,
  host: 'smtp.example',
  port: 587,
  from_address: 'noreply@example',
  username: 'mailer',
  password_set: true,
  starttls: true,
  effective: 'tenant',
};

const NONE: SmtpConfig = {
  configured: false,
  host: null,
  port: null,
  from_address: null,
  username: null,
  password_set: false,
  starttls: null,
  effective: 'none',
};

function values(over: Partial<RelayValues> = {}): RelayValues {
  return { ...relayValues(CONFIGURED), ...over };
}

describe('relayValues', () => {
  it('reads a stored relay, with no password in the form', () => {
    expect(relayValues(CONFIGURED)).toEqual({
      host: 'smtp.example',
      port: '587',
      from_address: 'noreply@example',
      username: 'mailer',
      starttls: true,
      password: '',
      remove_password: false,
    });
  });

  it('starts a tenant without one on the submission port, with TLS', () => {
    expect(relayValues(NONE)).toEqual({
      host: '',
      port: '587',
      from_address: '',
      username: '',
      starttls: true,
      password: '',
      remove_password: false,
    });
  });
});

describe('relayRequest', () => {
  it('leaves the password out to keep the stored one', () => {
    const body = relayRequest(values());
    expect(body).toEqual({
      host: 'smtp.example',
      port: 587,
      from_address: 'noreply@example',
      username: 'mailer',
      starttls: true,
    });
    expect(Object.hasOwn(body, 'password')).toBe(false);
  });

  it('sends a typed password to replace it', () => {
    expect(relayRequest(values({ password: 's3cret' })).password).toBe('s3cret');
  });

  it('sends null to clear it, whatever was typed beside it', () => {
    const body = relayRequest(values({ remove_password: true, password: 'ignored' }));
    expect(body.password).toBeNull();
  });

  it('sends an empty username as none, and trims what is typed', () => {
    const body = relayRequest(values({ username: '  ', host: ' smtp.example ' }));
    expect(body.username).toBeNull();
    expect(body.host).toBe('smtp.example');
  });
});

describe('relayBlocked', () => {
  it('is nothing for a relay the server could take', () => {
    expect(relayBlocked(values())).toBeUndefined();
  });

  it('holds Save for a missing host or sender, or a port outside 1 to 65535', () => {
    expect(relayBlocked(values({ host: ' ' }))).toMatch(/host/u);
    expect(relayBlocked(values({ from_address: '' }))).toMatch(/sender/u);
    expect(relayBlocked(values({ port: '0' }))).toMatch(/port/u);
    expect(relayBlocked(values({ port: '65536' }))).toMatch(/65535/u);
    expect(relayBlocked(values({ port: '58x' }))).toMatch(/port/u);
    expect(relayBlocked(values({ port: '' }))).toMatch(/port/u);
    expect(relayBlocked(values({ port: '1e3' }))).toMatch(/port/u);
    expect(relayBlocked(values({ port: '0x10' }))).toMatch(/port/u);
    expect(relayBlocked(values({ port: ' 587' }))).toMatch(/port/u);
  });
});

describe('passwordHint', () => {
  it('says a stored password is kept when the field is left empty', () => {
    expect(passwordHint(CONFIGURED, values())).toMatch(/never shown.+keep/u);
  });

  it('says a new host, port or username will not reuse the stored password', () => {
    for (const over of [{ host: 'other.example' }, { port: '25' }, { username: 'other' }]) {
      expect(passwordHint(CONFIGURED, values(over))).toMatch(/only kept for the host/u);
    }
  });

  it('is quiet about that once a password is typed or removed', () => {
    expect(passwordHint(CONFIGURED, values({ host: 'o', password: 'x' }))).not.toMatch(
      /only kept/u,
    );
    expect(passwordHint(CONFIGURED, values({ host: 'o', remove_password: true }))).not.toMatch(
      /only kept/u,
    );
  });

  it('says a relay with no stored password needs none left empty', () => {
    expect(passwordHint({ ...CONFIGURED, password_set: false }, values())).toMatch(/needs none/u);
    expect(passwordHint(NONE, relayValues(NONE))).toMatch(/needs none/u);
  });
});

describe('relayHold', () => {
  it("keeps the section's own reason, and checks the relay only once it is edited", () => {
    expect(relayHold('Keep yours or take theirs.', true, values({ host: '' }))).toBe(
      'Keep yours or take theirs.',
    );
    expect(relayHold(undefined, false, values({ host: '' }))).toBeUndefined();
    expect(relayHold(undefined, true, values({ host: '' }))).toMatch(/host/u);
  });
});
