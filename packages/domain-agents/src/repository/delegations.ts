import { type TenantScopedDatabase } from '@odudu/db';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { agentDelegations, type AgentDelegationRecord } from '#/schema/agent-delegations';

export type { AgentDelegationRecord } from '#/schema/agent-delegations';

export interface NewAgentDelegation {
  id: string;
  tenantId: string;
  subjectId: string;
  clientId: string;
  actorClientId: string;
  scopeCeiling: string;
  expiresAt: Date;
}

// The most delegations one subject's list returns.
const LIST_LIMIT = 200;

// A delegation `subjectId` made through `clientId` that is neither revoked nor
// expired at `now`.
function active(subjectId: string, clientId: string, now: Date) {
  return and(
    eq(agentDelegations.subjectId, subjectId),
    eq(agentDelegations.clientId, clientId),
    isNull(agentDelegations.revokedAt),
    gt(agentDelegations.expiresAt, now),
  );
}

export function agentDelegationRepository(tx: TenantScopedDatabase) {
  return {
    async create(input: NewAgentDelegation): Promise<AgentDelegationRecord> {
      const rows = await tx.insert(agentDelegations).values(input).returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into agent_delegations returned no row');
      }
      return row;
    },

    async revoke(id: string, at: Date): Promise<boolean> {
      const rows = await tx
        .update(agentDelegations)
        .set({ revokedAt: at })
        .where(and(eq(agentDelegations.id, id), isNull(agentDelegations.revokedAt)))
        .returning({ id: agentDelegations.id });
      return rows.length > 0;
    },

    // The newest `LIST_LIMIT` of them, which is a claim's whole population: an
    // older actor falls off it and so is refused, never admitted.
    async activeFor(
      subjectId: string,
      clientId: string,
      now: Date,
    ): Promise<AgentDelegationRecord[]> {
      return tx
        .select()
        .from(agentDelegations)
        .where(active(subjectId, clientId, now))
        .orderBy(desc(agentDelegations.createdAt))
        .limit(LIST_LIMIT);
    },

    // The ones naming one actor, filtered in SQL so that however many others
    // the subject has made, none of this actor's is left out.
    async activeForActor(
      subjectId: string,
      clientId: string,
      actorClientId: string,
      now: Date,
    ): Promise<AgentDelegationRecord[]> {
      return tx
        .select()
        .from(agentDelegations)
        .where(
          and(active(subjectId, clientId, now), eq(agentDelegations.actorClientId, actorClientId)),
        )
        .orderBy(desc(agentDelegations.createdAt))
        .limit(LIST_LIMIT);
    },

    async hasActive(subjectId: string, clientId: string, now: Date): Promise<boolean> {
      const rows = await tx
        .select({ id: agentDelegations.id })
        .from(agentDelegations)
        .where(active(subjectId, clientId, now))
        .limit(1);
      return rows.length > 0;
    },

    async list(subjectId: string): Promise<AgentDelegationRecord[]> {
      return tx
        .select()
        .from(agentDelegations)
        .where(eq(agentDelegations.subjectId, subjectId))
        .orderBy(desc(agentDelegations.createdAt))
        .limit(LIST_LIMIT);
    },
  };
}
