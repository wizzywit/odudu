import { describe, expect, it } from 'vitest';
import { assertDetailAllowed, AUDIT_EVENT_TYPES } from '#/service/vocabulary';

describe('assertDetailAllowed', () => {
  it('accepts the detail keys token.issue names', () => {
    expect(() => {
      assertDetailAllowed('token.issue', { grant_type: 'authorization_code', scope: 'openid' });
    }).not.toThrow();
  });

  it('rejects a key token.issue does not name', () => {
    expect(() => {
      assertDetailAllowed('token.issue', { grant_type: 'x', client_secret: 's' });
    }).toThrow(/client_secret/);
  });

  it('accepts factor and a valid reason on login.password', () => {
    expect(() => {
      assertDetailAllowed('login.password', { factor: 'password', reason: 'bad_credential' });
    }).not.toThrow();
  });

  it('rejects a key login.password does not name', () => {
    expect(() => {
      assertDetailAllowed('login.password', {
        factor: 'password',
        reason: 'bad_credential',
        username: 'alice',
      });
    }).toThrow(/username/);
  });

  it('rejects a reason value outside the vocabulary', () => {
    expect(() => {
      assertDetailAllowed('login.password', { reason: 'nonsense' });
    }).toThrow(/nonsense/);
  });

  it('lists every event type, admin_mutation first', () => {
    expect(AUDIT_EVENT_TYPES).toEqual([
      'admin_mutation',
      'admin_access',
      'authentication',
      'session',
      'token',
      'credential',
    ]);
  });
});
