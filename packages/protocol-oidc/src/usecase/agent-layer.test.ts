import { type TenantScopedDatabase } from '@odudu/db';
import { type ClientRecord } from '@odudu/domain-tenant';
import { describe, expect, it } from 'vitest';
import { applyAgentLayer, type AgentLayerInput } from '#/usecase/agent-layer';

// A transaction that fails on any use: a client that is not an agent type
// must be answered without reading or writing anything.
const untouchable = new Proxy(
  {},
  {
    get() {
      throw new Error('the transaction was used');
    },
  },
) as TenantScopedDatabase;

const input: AgentLayerInput = {
  client: { id: 'db-id', clientId: 'plain-client' } as ClientRecord,
  agentType: false,
  subject: {
    subjectId: 's',
    scope: ['openid', 'profile'],
    sessionId: null,
    grantId: 'g',
    clientDbId: 'db-id',
    requestedUserinfoClaims: null,
    act: undefined,
    mayAct: undefined,
    expiresAt: null,
  },
  actorSubject: 'plain-client',
  requestedScope: ['profile', 'openid'],
  now: new Date('2026-01-01T00:00:00Z'),
};

const deps = {
  tenantId: 't',
  lifespans: {
    ssoSessionIdleSeconds: 1,
    ssoSessionMaxSeconds: 1,
    rememberMeIdleSeconds: 1,
    rememberMeMaxSeconds: 1,
  },
};

describe('applyAgentLayer for a client that is not an agent type', () => {
  it('returns the actor and scope it was given, with no instance', async () => {
    expect(await applyAgentLayer(untouchable, deps, input)).toEqual({
      kind: 'ok',
      actorSub: 'plain-client',
      instance: null,
      scope: ['profile', 'openid'],
    });
  });
});
