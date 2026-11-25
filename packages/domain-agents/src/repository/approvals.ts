import { type TenantScopedDatabase } from '@odudu/db';
import { and, count, desc, eq, gt, lt, lte } from 'drizzle-orm';
import {
  agentApprovals,
  type AgentApprovalChannel,
  type AgentApprovalRecord,
  type AgentApprovalState,
} from '#/schema/agent-approvals';

export type {
  AgentApprovalChannel,
  AgentApprovalRecord,
  AgentApprovalState,
} from '#/schema/agent-approvals';

export interface NewAgentApproval {
  id: string;
  tenantId: string;
  subjectId: string;
  requestingClientId: string;
  instanceId: string | null;
  kind: string;
  summary: string;
  actionDigest: string;
  expiresAt: Date;
}

export interface AgentApprovalPageFilter {
  state?: AgentApprovalState;
  // Resumes strictly before this id.
  beforeId?: string;
  limit: number;
}

export function agentApprovalRepository(tx: TenantScopedDatabase) {
  return {
    async create(input: NewAgentApproval): Promise<AgentApprovalRecord> {
      const rows = await tx.insert(agentApprovals).values(input).returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into agent_approvals returned no row');
      }
      return row;
    },

    async byId(id: string): Promise<AgentApprovalRecord | null> {
      const rows = await tx.select().from(agentApprovals).where(eq(agentApprovals.id, id));
      return rows[0] ?? null;
    },

    // A page of the tenant's approvals, newest first (an id is time-ordered), alone
    // or in one state; the tenant and id, or the tenant, state and id, is the index.
    async page(filter: AgentApprovalPageFilter): Promise<AgentApprovalRecord[]> {
      return tx
        .select()
        .from(agentApprovals)
        .where(
          and(
            filter.state === undefined ? undefined : eq(agentApprovals.state, filter.state),
            filter.beforeId === undefined ? undefined : lt(agentApprovals.id, filter.beforeId),
          ),
        )
        .orderBy(desc(agentApprovals.id))
        .limit(filter.limit);
    },

    // One conditional UPDATE, so of two concurrent decisions exactly one wins.
    async decide(
      id: string,
      state: 'approved' | 'denied',
      via: AgentApprovalChannel,
      now: Date,
    ): Promise<boolean> {
      const rows = await tx
        .update(agentApprovals)
        .set({ state, decidedVia: via, decidedAt: now })
        .where(
          and(
            eq(agentApprovals.id, id),
            eq(agentApprovals.state, 'pending'),
            gt(agentApprovals.expiresAt, now),
          ),
        )
        .returning({ id: agentApprovals.id });
      return rows.length > 0;
    },

    // Spends an approved approval, once, for the action it names.
    async consume(id: string, digest: string, now: Date): Promise<boolean> {
      const rows = await tx
        .update(agentApprovals)
        .set({ state: 'consumed' })
        .where(
          and(
            eq(agentApprovals.id, id),
            eq(agentApprovals.state, 'approved'),
            eq(agentApprovals.actionDigest, digest),
            gt(agentApprovals.expiresAt, now),
          ),
        )
        .returning({ id: agentApprovals.id });
      return rows.length > 0;
    },

    async pendingCount(subjectId: string, now: Date): Promise<number> {
      const rows = await tx
        .select({ n: count() })
        .from(agentApprovals)
        .where(
          and(
            eq(agentApprovals.subjectId, subjectId),
            eq(agentApprovals.state, 'pending'),
            gt(agentApprovals.expiresAt, now),
          ),
        );
      return rows[0]?.n ?? 0;
    },

    async expireDue(now: Date): Promise<number> {
      const rows = await tx
        .update(agentApprovals)
        .set({ state: 'expired' })
        .where(and(eq(agentApprovals.state, 'pending'), lte(agentApprovals.expiresAt, now)))
        .returning({ id: agentApprovals.id });
      return rows.length;
    },
  };
}
