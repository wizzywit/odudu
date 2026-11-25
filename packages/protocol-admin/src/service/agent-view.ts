import { type AgentBudget, type AgentInstance } from '@odudu/contracts/admin';

interface Lifetime {
  readonly revokedAt: Date | null;
  readonly expiresAt: Date;
  readonly idleExpiresAt: Date | null;
}

interface Slice {
  readonly sliceMutating: number;
  readonly sliceCreates: number;
  readonly spentMutating: number;
  readonly spentCreates: number;
}

// An instance past its lifetime stays `expired` until the retention pass
// revokes it, and a token for it is refused in the meantime.
export function instanceState(instance: Lifetime, now: Date): AgentInstance['state'] {
  if (instance.revokedAt !== null) return 'revoked';
  const lapsed =
    instance.expiresAt <= now || (instance.idleExpiresAt !== null && instance.idleExpiresAt <= now);
  return lapsed ? 'expired' : 'live';
}

export function remainingBudget(instance: Slice): AgentBudget {
  return {
    mutating: Math.max(0, instance.sliceMutating - instance.spentMutating),
    creates: Math.max(0, instance.sliceCreates - instance.spentCreates),
  };
}
