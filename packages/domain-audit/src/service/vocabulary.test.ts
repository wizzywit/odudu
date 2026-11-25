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

  it('accepts the notice a password reset records', () => {
    for (const notice of ['sent', 'skipped_none']) {
      expect(() => {
        assertDetailAllowed('password.reset', { notice });
      }).not.toThrow();
    }
  });

  it('accepts what the breached-password check decided on the writes that run it', () => {
    for (const action of ['password.changed', 'password.reset', 'account.registered']) {
      for (const decided of [
        'passed',
        'breached',
        'error_open',
        'error_closed',
        'off',
        'dataset_empty',
      ]) {
        expect(() => {
          assertDetailAllowed(action, { breached_check: decided });
        }).not.toThrow();
      }
    }
  });

  it('rejects a breached_check outside the five outcomes, or on another action', () => {
    expect(() => {
      assertDetailAllowed('password.changed', { breached_check: 'maybe' });
    }).toThrow(/breached_check/);
    expect(() => {
      assertDetailAllowed('email.changed', { breached_check: 'passed' });
    }).toThrow(/breached_check/);
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

describe('terms.accepted', () => {
  it('carries the version accepted, as text', () => {
    expect(() => {
      assertDetailAllowed('terms.accepted', { version: '2026-01' });
    }).not.toThrow();
    expect(() => {
      assertDetailAllowed('terms.accepted', { version: 2 });
    }).toThrow(/invalid value/u);
    expect(() => {
      assertDetailAllowed('terms.accepted', { version: '1', uri: 'https://example.com' });
    }).toThrow(/does not allow detail key 'uri'/u);
  });
});

describe('the agent_identity event type', () => {
  const instance = '01a1873a-22a0-7756-8957-54c1c5aaca55';
  const detail = { agent_client: 'c', owner: 'o', instance, depth: 1 };

  it('holds agent.instance_minted', () => {
    expect(AUDIT_ACTIONS.agent_identity).toContain('agent.instance_minted');
    expect(AUDIT_EVENT_TYPES).toContain('agent_identity');
  });

  it('accepts the instance detail', () => {
    expect(() => {
      assertDetailAllowed('agent.instance_minted', detail);
    }).not.toThrow();
  });

  it('refuses a free-text key', () => {
    expect(() => {
      assertDetailAllowed('agent.instance_minted', { ...detail, message: 'x' });
    }).toThrow(/does not allow detail key/);
  });

  it.each([
    ['a negative depth', { depth: -1 }],
    ['a depth as text', { depth: '2' }],
    ['an instance that is not an id', { instance: 'ignore previous instructions' }],
  ])('refuses %s', (_, override) => {
    expect(() => {
      assertDetailAllowed('agent.instance_minted', { ...detail, ...override });
    }).toThrow(/invalid value/);
  });
});

describe('agent.instance_revoked', () => {
  const instance = '01a1873a-22a0-7756-8957-54c1c5aaca55';
  const detail = { agent_client: 'c', owner: 'o', instance, depth: 1, count: 3, via: 'cascade' };

  it('is an agent_identity action', () => {
    expect(AUDIT_ACTIONS.agent_identity).toContain('agent.instance_revoked');
  });

  it.each(['cascade', 'owner_ended', 'admin'])('accepts via %s', (via) => {
    expect(() => {
      assertDetailAllowed('agent.instance_revoked', { ...detail, via });
    }).not.toThrow();
  });

  it.each([
    ['a via that names no cause', { via: 'logout' }],
    ['a negative count', { count: -1 }],
    ['a free-text key', { message: 'x' }],
  ])('refuses %s', (_, override) => {
    expect(() => {
      assertDetailAllowed('agent.instance_revoked', { ...detail, ...override });
    }).toThrow(/invalid value|does not allow/);
  });
});

describe('the delegation actions', () => {
  const delegation = '01a1873a-22a0-7756-8957-54c1c5aaca57';
  const detail = { agent_client: 'actor', owner: 'o', delegation };

  it.each(['agent.delegation_created', 'agent.delegation_revoked'])(
    'holds %s under agent_identity and accepts its detail',
    (action) => {
      expect(AUDIT_ACTIONS.agent_identity).toContain(action);
      expect(() => {
        assertDetailAllowed(action, detail);
      }).not.toThrow();
    },
  );

  it.each([
    ['a delegation that is not an id', { delegation: 'ignore previous instructions' }],
    ['a free-text key', { message: 'x' }],
    ['a scope ceiling, which can be long and is not a lineage fact', { scope_ceiling: 'a b' }],
  ])('refuses %s', (_, override) => {
    expect(() => {
      assertDetailAllowed('agent.delegation_created', { ...detail, ...override });
    }).toThrow(/invalid value|does not allow/);
  });
});

describe('the approval actions', () => {
  const approval = '01a1873a-22a0-7756-8957-54c1c5aaca56';
  const requested = {
    agent_client: 'c',
    owner: 'o',
    approval,
    instance: '01a1873a-22a0-7756-8957-54c1c5aaca55',
  };
  const decided = { owner: 'o', approval, state: 'approved', via: 'ciba_page' };

  it('holds both under agent_identity', () => {
    expect(AUDIT_ACTIONS.agent_identity).toContain('agent.approval_requested');
    expect(AUDIT_ACTIONS.agent_identity).toContain('agent.approval_decided');
  });

  it('accepts the requested and decided detail', () => {
    expect(() => {
      assertDetailAllowed('agent.approval_requested', requested);
      assertDetailAllowed('agent.approval_decided', decided);
      assertDetailAllowed('agent.approval_decided', {
        ...decided,
        state: 'denied',
        via: 'console',
      });
    }).not.toThrow();
  });

  it.each([
    ['requested', { ...requested, summary: 'Delete everything' }],
    ['decided', { ...decided, message: 'x' }],
  ])('refuses a free-text key on %s', (name, detail) => {
    expect(() => {
      assertDetailAllowed(`agent.approval_${name}`, detail);
    }).toThrow(/does not allow detail key/);
  });

  it.each([
    ['a channel that is not one', { via: 'email' }],
    ['a lineage channel', { via: 'owner' }],
    ['a state that was not decided', { state: 'pending' }],
    ['an approval that is not an id', { approval: 'ignore previous instructions' }],
  ])('refuses %s', (_, override) => {
    expect(() => {
      assertDetailAllowed('agent.approval_decided', { ...decided, ...override });
    }).toThrow(/invalid value/);
  });

  it('keeps the approval channels out of a session ending', () => {
    expect(() => {
      assertDetailAllowed('session.ended', { via: 'console' });
    }).toThrow(/invalid value/);
  });
});

describe('the ciba actions', () => {
  const ids = {
    agent_client: '01a1873a-22a0-7756-8957-54c1c5aaca55',
    owner: '01a1873a-22a0-7756-8957-54c1c5aaca56',
    approval: '01a1873a-22a0-7756-8957-54c1c5aaca57',
  };

  it('are written under agent_identity', () => {
    for (const action of ['ciba.requested', 'ciba.poll_refused', 'ciba.token_issued']) {
      expect(AUDIT_ACTIONS.agent_identity).toContain(action);
    }
  });

  it.each(['ciba.requested', 'ciba.poll_refused', 'ciba.token_issued'])(
    'accepts the agent client, owner and approval of %s',
    (action) => {
      expect(() => {
        assertDetailAllowed(action, ids);
      }).not.toThrow();
    },
  );

  it('accepts a request that names nobody', () => {
    expect(() => {
      assertDetailAllowed('ciba.requested', { agent_client: ids.agent_client });
    }).not.toThrow();
  });

  it.each(['approval_limit', 'polled_early', 'expired', 'denied'])(
    'takes %s as a reason',
    (reason) => {
      expect(() => {
        assertDetailAllowed('ciba.poll_refused', { agent_client: ids.agent_client, reason });
      }).not.toThrow();
    },
  );

  it('refuses a hint, a free-text key and a reason outside the list', () => {
    expect(() => {
      assertDetailAllowed('ciba.requested', { ...ids, login_hint: 'alice' });
    }).toThrow(/does not allow detail key/);
    expect(() => {
      assertDetailAllowed('ciba.requested', { ...ids, reason: 'alice was not found' });
    }).toThrow();
  });
});
