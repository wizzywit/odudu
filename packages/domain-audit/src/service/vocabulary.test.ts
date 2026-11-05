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
