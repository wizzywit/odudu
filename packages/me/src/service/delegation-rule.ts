import type { MeDelegationClient } from '#/service/delegation';

export type DelegationClients =
  | {
      readonly kind: 'ok';
      readonly client: MeDelegationClient;
      readonly actor: MeDelegationClient;
    }
  | {
      readonly kind: 'refused';
      readonly field: 'client_id' | 'actor_client_id';
      readonly description: string;
    };

// Whether a person may make this delegation: both clients are enabled clients
// of the tenant, and the one that acts is an agent client. A client that is
// not an agent type gets no delegation, so a person cannot hand their account
// to an ordinary application through this door.
export function delegationClients(
  client: MeDelegationClient | null,
  actor: MeDelegationClient | null,
): DelegationClients {
  const unusable = 'is not an enabled client of this tenant';
  if (client?.enabled !== true) {
    return { kind: 'refused', field: 'client_id', description: unusable };
  }
  if (actor?.enabled !== true) {
    return { kind: 'refused', field: 'actor_client_id', description: unusable };
  }
  if (!actor.agentType) {
    return { kind: 'refused', field: 'actor_client_id', description: 'is not an agent client' };
  }
  return { kind: 'ok', client, actor };
}
