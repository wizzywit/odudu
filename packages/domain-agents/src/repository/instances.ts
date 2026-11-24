import { type TenantScopedDatabase } from '@odudu/db';
import { subjects } from '@odudu/domain-identity';
import { and, count, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { agentInstances, type AgentInstanceRecord } from '#/schema/agent-instances';

export type { AgentInstanceRecord } from '#/schema/agent-instances';

export interface NewAgentInstance {
  id: string;
  tenantId: string;
  ownerSubjectId: string;
  agentClientId: string;
  parentInstanceId: string | null;
  rootGrantId: string;
  depth: number;
  scope: string;
  expiresAt: Date;
  idleExpiresAt: Date | null;
}

// Not revoked, not past its fixed expiry and not past its idle expiry, by the
// database's clock.
const LIVE = and(
  isNull(agentInstances.revokedAt),
  gt(agentInstances.expiresAt, sql`now()`),
  or(isNull(agentInstances.idleExpiresAt), gt(agentInstances.idleExpiresAt, sql`now()`)),
);

export function agentInstanceRepository(tx: TenantScopedDatabase) {
  return {
    // The subject row comes first because the instance's id is a foreign key
    // to it. A duplicate id fails on the subject's primary key.
    async mint(input: NewAgentInstance): Promise<AgentInstanceRecord> {
      await tx
        .insert(subjects)
        .values({ id: input.id, tenantId: input.tenantId, type: 'agent_instance' });
      const rows = await tx
        .insert(agentInstances)
        .values({
          id: input.id,
          tenantId: input.tenantId,
          ownerSubjectId: input.ownerSubjectId,
          agentClientId: input.agentClientId,
          parentInstanceId: input.parentInstanceId,
          rootGrantId: input.rootGrantId,
          depth: input.depth,
          scope: input.scope,
          expiresAt: input.expiresAt,
          idleExpiresAt: input.idleExpiresAt,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into agent_instances returned no row');
      }
      return row;
    },

    async byId(id: string): Promise<AgentInstanceRecord | null> {
      const rows = await tx.select().from(agentInstances).where(eq(agentInstances.id, id));
      return rows[0] ?? null;
    },

    async liveChildren(parentId: string): Promise<number> {
      const rows = await tx
        .select({ n: count() })
        .from(agentInstances)
        .where(and(eq(agentInstances.parentInstanceId, parentId), LIVE));
      return rows[0]?.n ?? 0;
    },

    async liveCount(): Promise<number> {
      const rows = await tx.select({ n: count() }).from(agentInstances).where(LIVE);
      return rows[0]?.n ?? 0;
    },

    // Slides the idle expiry of an instance that has one; a fixed-lifetime
    // instance has nothing to slide, so it and a lapsed one return false.
    async touch(id: string, now: Date, idleSeconds: number, sessionEndsAt: Date): Promise<boolean> {
      const rows = await tx
        .update(agentInstances)
        .set({
          idleExpiresAt: sql`least(${now.toISOString()}::timestamptz + make_interval(secs => ${idleSeconds}), ${sessionEndsAt.toISOString()}::timestamptz)`,
        })
        .where(
          and(
            eq(agentInstances.id, id),
            isNull(agentInstances.revokedAt),
            gt(agentInstances.expiresAt, now),
            isNotNull(agentInstances.idleExpiresAt),
            gt(agentInstances.idleExpiresAt, now),
          ),
        )
        .returning({ id: agentInstances.id });
      return rows.length > 0;
    },

    // The instance and everything minted beneath it. `depth` is capped at 8,
    // which bounds the walk.
    async revoke(id: string, at: Date): Promise<number> {
      const rows = await tx.execute(sql`
        with recursive tree as (
          select id from agent_instances where id = ${id}
          union all
          select c.id from agent_instances c join tree t on c.parent_instance_id = t.id
        )
        update agent_instances set revoked_at = ${at.toISOString()}::timestamptz
         where id in (select id from tree) and revoked_at is null
        returning id`);
      return (rows as unknown as unknown[]).length;
    },

    // Revokes what lapsed, then deletes instances revoked before
    // `tombstoneBefore` together with their subjects.
    async expireDue(
      now: Date,
      tombstoneBefore: Date,
    ): Promise<{ expired: number; deleted: number }> {
      const expired = await tx
        .update(agentInstances)
        .set({ revokedAt: now })
        .where(
          and(
            isNull(agentInstances.revokedAt),
            or(lte(agentInstances.expiresAt, now), lte(agentInstances.idleExpiresAt, now)),
          ),
        )
        .returning({ id: agentInstances.id });
      const gone = await tx
        .delete(agentInstances)
        .where(
          and(isNotNull(agentInstances.revokedAt), lt(agentInstances.revokedAt, tombstoneBefore)),
        )
        .returning({ id: agentInstances.id });
      if (gone.length > 0) {
        await tx.delete(subjects).where(
          inArray(
            subjects.id,
            gone.map((row) => row.id),
          ),
        );
      }
      return { expired: expired.length, deleted: gone.length };
    },
  };
}
