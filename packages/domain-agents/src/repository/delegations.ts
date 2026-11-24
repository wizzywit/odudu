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

    async activeFor(
      subjectId: string,
      clientId: string,
      now: Date,
    ): Promise<AgentDelegationRecord[]> {
      return tx
        .select()
        .from(agentDelegations)
        .where(
          and(
            eq(agentDelegations.subjectId, subjectId),
            eq(agentDelegations.clientId, clientId),
            isNull(agentDelegations.revokedAt),
            gt(agentDelegations.expiresAt, now),
          ),
        )
        .orderBy(desc(agentDelegations.createdAt))
        .limit(LIST_LIMIT);
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
