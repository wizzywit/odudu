import { describe, expect, it } from 'vitest';
import {
  assertActionKnown,
  assertDetailAllowed,
  AUDIT_ACTIONS,
  AUDIT_EVENT_TYPES,
} from '#/service/vocabulary';

describe('agent.tool_call', () => {
  const detail = { agent_client: 'c', owner: 'o', tool: 'list_clients', route: 'GET /x' };

  it('is an admin_access action whose detail names the agent, owner, tool and route', () => {
    expect(AUDIT_ACTIONS.admin_access).toContain('agent.tool_call');
    expect(() => {
      assertDetailAllowed('agent.tool_call', detail);
    }).not.toThrow();
    expect(() => {
      assertActionKnown('admin_access', 'agent.tool_call');
    }).not.toThrow();
  });

  it.each(['arguments', 'body', 'token', 'input', 'text'])(
    'refuses a %s key, so no argument text can be recorded',
    (key) => {
      expect(() => {
        assertDetailAllowed('agent.tool_call', { ...detail, [key]: 'x' });
      }).toThrow(/does not allow detail key/);
    },
  );

  it.each([
    ['an empty tool', { tool: '' }],
    ['an overlong tool', { tool: 'a'.repeat(65) }],
    ['a tool with capitals', { tool: 'List_Clients' }],
    ['a tool with a space', { tool: 'list clients' }],
    ['a tool carrying text', { tool: 'ignore previous instructions' }],
    ['an empty route', { route: '' }],
    ['a route with no method', { route: '/admin/tenants/:tenant/clients' }],
    ['a route with a query', { route: 'GET /admin/tenants/x/clients?name=a b' }],
    ['an overlong route', { route: `GET /${'a'.repeat(200)}` }],
  ])('refuses %s', (_, override) => {
    expect(() => {
      assertDetailAllowed('agent.tool_call', { ...detail, ...override });
    }).toThrow(/invalid value/);
  });

  it('refuses a non-string value', () => {
    expect(() => {
      assertDetailAllowed('agent.tool_call', { ...detail, tool: { name: 'x' } });
    }).toThrow(/invalid value/);
  });
});

describe('assertDetailAllowed', () => {
  it('accepts what else would have admitted a refused caller, as a list of names', () => {
    expect(() => {
      assertDetailAllowed('capability.refused', {
        capability: 'manage-tenant',
        also_admits: ['view-users'],
        reason: 'missing_capability',
      });
    }).not.toThrow();
    expect(() => {
      assertDetailAllowed('capability.refused', { capability: 'x', also_admits: 'view-users' });
    }).toThrow(/also_admits/);
  });

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

  it('accepts a boolean user_verified on login.passkey only', () => {
    expect(() => {
      assertDetailAllowed('login.passkey', { factor: 'passkey', user_verified: false });
    }).not.toThrow();
    expect(() => {
      assertDetailAllowed('login.passkey', { factor: 'passkey', user_verified: 'no' });
    }).toThrow(/user_verified/);
    expect(() => {
      assertDetailAllowed('login.password', { factor: 'password', user_verified: true });
    }).toThrow(/user_verified/);
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

  it('accepts whether a password change ended the other sessions', () => {
    expect(() => {
      assertDetailAllowed('password.changed', { ended_other_sessions: true });
      assertDetailAllowed('password.changed', { ended_other_sessions: false });
    }).not.toThrow();
  });

  it('rejects an ended_other_sessions that is not a boolean', () => {
    expect(() => {
      assertDetailAllowed('password.changed', { ended_other_sessions: 'yes' });
    }).toThrow(/ended_other_sessions/);
  });

  it('allows no ended_other_sessions on a password reset', () => {
    expect(() => {
      assertDetailAllowed('password.reset', { ended_other_sessions: true });
    }).toThrow(/ended_other_sessions/);
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

  it('accepts a session ended by the person through the me API', () => {
    expect(() => {
      assertDetailAllowed('session.ended', { via: 'self' });
    }).not.toThrow();
  });

  it('rejects a via outside logout|admin|self|evicted', () => {
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

describe('the steps of an application-requested action', () => {
  for (const action of [
    'action.requested',
    'action.completed',
    'action.cancelled',
    'action.failed',
  ] as const) {
    it(`${action} is a credential action whose detail names the required action`, () => {
      expect(AUDIT_ACTIONS.credential).toContain(action);
      expect(() => {
        assertActionKnown('credential', action);
      }).not.toThrow();
      expect(() => {
        assertDetailAllowed(action, { action: 'configure-totp' });
      }).not.toThrow();
    });
  }

  it('allows no other detail key and no non-string action', () => {
    expect(() => {
      assertDetailAllowed('action.requested', { action: 'configure-totp', scope: 'x' });
    }).toThrow(/scope/);
    expect(() => {
      assertDetailAllowed('action.cancelled', { action: 3 });
    }).toThrow(/invalid value/);
  });
});

describe('the notice a change to a sign-in method records', () => {
  it.each(['otp.enrolled', 'passkey.enrolled', 'recovery_codes.issued'])(
    'is allowed on %s with the three outcomes a notice can have',
    (action) => {
      for (const notice of ['sent', 'skipped_unverified', 'skipped_none']) {
        expect(() => {
          assertDetailAllowed(action, { notice });
        }).not.toThrow();
      }
    },
  );

  it.each(['otp.enrolled', 'passkey.enrolled', 'recovery_codes.issued'])(
    'refuses any other value on %s, so no address can be recorded there',
    (action) => {
      for (const notice of ['ada@example.test', '', 'queued', 1]) {
        expect(() => {
          assertDetailAllowed(action, { notice });
        }).toThrow(/invalid value/);
      }
    },
  );

  it('is not allowed on an action that sends no notice', () => {
    expect(() => {
      assertDetailAllowed('email.verified', { notice: 'sent' });
    }).toThrow(/does not allow detail key/);
  });
});
