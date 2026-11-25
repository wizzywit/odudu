import { MAX_DELEGATIONS } from '@odudu/contracts/me';
import { describe, expect, it } from 'vitest';
import type { MeDelegationClient, MeDelegationRecord } from '#/service/delegation';
import type { MeReads } from '#/repository/reads';
import type { MeWriteTx } from '#/repository/writes';
import type { MeCaller } from '#/usecase/admit-me';
import type { MeWriteDeps } from '#/usecase/writes';
import { createDelegation, listDelegations, revokeDelegation } from '#/usecase/delegations';

const NOW = new Date('2026-11-25T10:00:00Z');
const ID = '01a0a992-4657-7d89-8fbf-3385f54810d1';

const CALLER: MeCaller = {
  tenantId: 'tenant-1',
  subjectId: 'subject-1',
  sessionId: null,
  clientId: 'portal',
  issuer: 'https://id.example.com/tenants/acme',
  freshnessSeconds: 300,
  usernameEditable: false,
  lifespans: {
    ssoSessionIdleSeconds: 1800,
    ssoSessionMaxSeconds: 36_000,
    rememberMeIdleSeconds: 604_800,
    rememberMeMaxSeconds: 2_592_000,
  },
};

const CLIENTS: Record<string, MeDelegationClient> = {
  portal: { id: 'row-portal', clientKey: 'portal', enabled: true, agentType: false },
  assistant: { id: 'row-assistant', clientKey: 'assistant', enabled: true, agentType: true },
  plain: { id: 'row-plain', clientKey: 'plain', enabled: true, agentType: false },
  off: { id: 'row-off', clientKey: 'off', enabled: false, agentType: true },
};

const REQUEST = {
  client_id: 'portal',
  actor_client_id: 'assistant',
  scope_ceiling: 'openid profile',
  expires_in: 3600,
};

function record(over: Partial<MeDelegationRecord> = {}): MeDelegationRecord {
  return {
    id: ID,
    clientKey: 'portal',
    actorClientKey: 'assistant',
    scopeCeiling: 'openid profile',
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    createdAt: NOW,
    ...over,
  };
}

interface Log {
  calls: string[];
  audits: unknown[];
  created: unknown[];
}

function world(over: Partial<MeWriteTx> = {}): { deps: MeWriteDeps; log: Log } {
  const log: Log = { calls: [], audits: [], created: [] };
  const tx = {
    delegationClient: (key: string) => {
      log.calls.push(`delegationClient ${key}`);
      return Promise.resolve(CLIENTS[key] ?? null);
    },
    createDelegation: (input: unknown) => {
      log.calls.push('createDelegation');
      log.created.push(input);
      return Promise.resolve(record());
    },
    revokeDelegation: (subjectId: string, id: string) => {
      log.calls.push(`revokeDelegation ${subjectId} ${id}`);
      return Promise.resolve(record());
    },
    auditDelegation: (event: unknown) => {
      log.audits.push(event);
      return Promise.resolve();
    },
    ...over,
  } as MeWriteTx;
  return {
    deps: {
      writes: { transact: (_tenant, run) => run(tx) },
      now: () => NOW,
    },
    log,
  };
}

describe('createDelegation', () => {
  it('creates under the cap with the expiry counted from now, and files one audit row', async () => {
    const { deps, log } = world();
    const outcome = await createDelegation(deps, CALLER, REQUEST);
    expect(outcome).toEqual({ kind: 'ok', delegation: record() });
    expect(log.created).toEqual([
      {
        subjectId: 'subject-1',
        client: CLIENTS.portal,
        actor: CLIENTS.assistant,
        scopeCeiling: 'openid profile',
        expiresAt: new Date('2026-11-25T11:00:00Z'),
        now: NOW,
        cap: MAX_DELEGATIONS,
      },
    ]);
    expect(log.audits).toEqual([
      {
        action: 'agent.delegation_created',
        delegationId: ID,
        ownerSubjectId: 'subject-1',
        viaClientKey: 'portal',
        agentClientKey: 'assistant',
      },
    ]);
  });

  it.each([
    ['a sign-in client that is not there', { client_id: 'missing' }, 'client_id'],
    ['a sign-in client that is disabled', { client_id: 'off' }, 'client_id'],
    ['an actor that is not there', { actor_client_id: 'missing' }, 'actor_client_id'],
    ['an actor that is disabled', { actor_client_id: 'off' }, 'actor_client_id'],
    ['an actor that is not an agent client', { actor_client_id: 'plain' }, 'actor_client_id'],
  ])('refuses %s, naming the member, and writes nothing', async (_, over, member) => {
    const { deps, log } = world();
    const outcome = await createDelegation(deps, CALLER, { ...REQUEST, ...over });
    expect(outcome).toMatchObject({ kind: 'invalid', field: member });
    expect(log.calls).not.toContain('createDelegation');
    expect(log.audits).toEqual([]);
  });

  it('says the limit is reached, and files nothing, when the cap leaves no room', async () => {
    const { deps, log } = world({ createDelegation: () => Promise.resolve(null) });
    expect(await createDelegation(deps, CALLER, REQUEST)).toEqual({ kind: 'limit_reached' });
    expect(log.audits).toEqual([]);
  });
});

describe('revokeDelegation', () => {
  it('revokes the caller’s own and files one audit row', async () => {
    const { deps, log } = world();
    expect(await revokeDelegation(deps, CALLER, ID)).toEqual({ kind: 'revoked' });
    expect(log.calls).toEqual([`revokeDelegation subject-1 ${ID}`]);
    expect(log.audits).toEqual([
      {
        action: 'agent.delegation_revoked',
        delegationId: ID,
        ownerSubjectId: 'subject-1',
        viaClientKey: 'portal',
        agentClientKey: 'assistant',
      },
    ]);
  });

  it('answers not found for one that is not theirs, there or live, filing nothing', async () => {
    const { deps, log } = world({ revokeDelegation: () => Promise.resolve(null) });
    expect(await revokeDelegation(deps, CALLER, ID)).toEqual({ kind: 'not_found' });
    expect(log.audits).toEqual([]);
  });

  it('answers not found for an id that is not a uuid without opening a transaction', async () => {
    const { deps, log } = world();
    expect(await revokeDelegation(deps, CALLER, 'nope')).toEqual({ kind: 'not_found' });
    expect(log.calls).toEqual([]);
  });
});

describe('listDelegations', () => {
  it('reads the caller’s own in the caller’s tenant at the time of the request', async () => {
    const seen: unknown[] = [];
    const unused = () => Promise.reject(new Error('not read'));
    const reads: MeReads = {
      profile: unused,
      credentials: unused,
      sessions: unused,
      consents: unused,
      delegations: (tenantId, subjectId, now) => {
        seen.push([tenantId, subjectId, now]);
        return Promise.resolve([record()]);
      },
    };
    const outcome = await listDelegations({ reads, now: () => NOW }, CALLER);
    expect(outcome).toEqual({ kind: 'ok', items: [record()] });
    expect(seen).toEqual([['tenant-1', 'subject-1', NOW]]);
  });
});
