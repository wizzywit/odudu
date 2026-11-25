import { type TenantScopedDatabase } from '@odudu/db';
import { and, count, desc, eq, gt, isNull, sql } from 'drizzle-orm';
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

    // Creates the delegation unless `subjectId` already holds `cap` live ones,
    // and answers null then. The subject's own lock serialises concurrent
    // creates, so none of them counts before another has inserted.
    async createUnderCap(
      input: NewAgentDelegation,
      cap: number,
      now: Date,
    ): Promise<AgentDelegationRecord | null> {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`agent_delegations:${input.tenantId}:${input.subjectId}`}, 0))`,
      );
      const held = await tx
        .select({ n: count() })
        .from(agentDelegations)
        .where(
          and(
            eq(agentDelegations.subjectId, input.subjectId),
            isNull(agentDelegations.revokedAt),
            gt(agentDelegations.expiresAt, now),
          ),
        );
      if ((held[0]?.n ?? 0) >= cap) return null;
      return this.create(input);
    },

    // Only the subject's own delegation is found; null where it is not theirs,
    // is not there, or was revoked already.
    async revoke(subjectId: string, id: string, at: Date): Promise<AgentDelegationRecord | null> {
      const rows = await tx
        .update(agentDelegations)
        .set({ revokedAt: at })
        .where(
          and(
            eq(agentDelegations.id, id),
            eq(agentDelegations.subjectId, subjectId),
            isNull(agentDelegations.revokedAt),
          ),
        )
        .returning();
      return rows[0] ?? null;
    },

    // What a person sees of their own: live delegations across every client,
    // newest first. The cap on creating them keeps it far below the limit.
    async activeOf(subjectId: string, now: Date): Promise<AgentDelegationRecord[]> {
      return tx
        .select()
        .from(agentDelegations)
        .where(
          and(
            eq(agentDelegations.subjectId, subjectId),
            isNull(agentDelegations.revokedAt),
            gt(agentDelegations.expiresAt, now),
          ),
        )
        .orderBy(desc(agentDelegations.createdAt))
        .limit(LIST_LIMIT);
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
