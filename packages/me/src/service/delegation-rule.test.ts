import { describe, expect, it } from 'vitest';
import type { MeDelegationClient } from '#/service/delegation';
import { delegationClients } from '#/service/delegation-rule';

const client = (over: Partial<MeDelegationClient> = {}): MeDelegationClient => ({
  id: 'row',
  clientKey: 'key',
  enabled: true,
  agentType: false,
  ...over,
});

describe('delegationClients', () => {
  it('admits an enabled client and an enabled agent client', () => {
    const actor = client({ agentType: true });
    expect(delegationClients(client(), actor)).toMatchObject({ kind: 'ok', actor });
  });

  it.each([
    ['no client', null, client({ agentType: true }), 'client_id'],
    ['a disabled client', client({ enabled: false }), client({ agentType: true }), 'client_id'],
    ['no actor', client(), null, 'actor_client_id'],
    ['a disabled actor', client(), client({ enabled: false, agentType: true }), 'actor_client_id'],
    ['an actor that is not an agent client', client(), client(), 'actor_client_id'],
  ])('refuses %s', (_, signIn, actor, field) => {
    expect(delegationClients(signIn, actor)).toMatchObject({ kind: 'refused', field });
  });
});
