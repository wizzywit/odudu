import { describe, expect, it } from 'vitest';
import {
  assertActionKnown,
  assertDetailAllowed,
  AUDIT_ACTIONS,
  AUDIT_EVENT_TYPES,
} from '#/service/vocabulary';

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

  it('passes an action outside the vocabulary through untouched', () => {
    expect(() => {
      assertDetailAllowed('client.create', { anything: 'goes', name: 'acme' });
    }).not.toThrow();
  });

  it('rejects any extra key on an action with no keys of its own', () => {
    expect(() => {
      assertDetailAllowed('password.changed', { username: 'alice' });
    }).toThrow(/username/);
  });

  it('rejects a mode outside delegation|impersonation', () => {
    expect(() => {
      assertDetailAllowed('token.exchange', {
        mode: 'takeover',
        scope: 'openid',
        requested_token_type: 'urn:x',
      });
    }).toThrow(/mode/);
  });

  it('rejects a via outside logout|admin|evicted', () => {
    expect(() => {
      assertDetailAllowed('session.ended', { via: 'timeout' });
    }).toThrow(/via/);
  });

  it('rejects a non-string factor', () => {
    expect(() => {
      assertDetailAllowed('login.password', { factor: 7 });
    }).toThrow(/factor/);
  });

  it('accepts unsupported_token_type as the reason a token exchange was refused', () => {
    expect(() => {
      assertDetailAllowed('token.exchange', { reason: 'unsupported_token_type' });
    }).not.toThrow();
  });

  it('lists every event type the vocabulary groups, admin_mutation first', () => {
    expect(AUDIT_EVENT_TYPES).toEqual(['admin_mutation', ...Object.keys(AUDIT_ACTIONS)]);
  });
});

describe('assertActionKnown', () => {
  it('accepts an action that belongs to its event type', () => {
    expect(() => {
      assertActionKnown('token', 'token.issue');
    }).not.toThrow();
  });

  it('rejects an action from a different event type', () => {
    expect(() => {
      assertActionKnown('session', 'token.issue');
    }).toThrow(/session/);
  });

  it('rejects a misspelled action', () => {
    expect(() => {
      assertActionKnown('token', 'token.isue');
    }).toThrow(/token\.isue/);
  });
});
