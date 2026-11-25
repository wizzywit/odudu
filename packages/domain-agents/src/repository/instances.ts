import { type TenantScopedDatabase } from '@odudu/db';
import { subjects } from '@odudu/domain-identity';
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  sql,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { agentInstances, type AgentInstanceRecord } from '#/schema/agent-instances';
import { lockLineageRoots } from '#/repository/lineage';

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
  // Left out, the column defaults (the tenant defaults) apply.
  slice?: { mutating: number; creates: number };
}

export type AgentInstanceState = 'live' | 'expired' | 'revoked';

export interface AgentInstancePageFilter {
  ownerSubjectId?: string;
  state?: AgentInstanceState;
  // Resumes strictly after this id.
  afterId?: string;
  limit: number;
  now: Date;
}

// Not revoked, not past its fixed expiry and not past its idle expiry at `now`.
function live(now: Date) {
  return and(
    isNull(agentInstances.revokedAt),
    gt(agentInstances.expiresAt, now),
    or(isNull(agentInstances.idleExpiresAt), gt(agentInstances.idleExpiresAt, now)),
  );
}

// Not revoked, and past its fixed expiry or its idle expiry at `now`. The earlier
// of the two is compared as one expression no index holds, so a page of these is
// read in id order from the tenant's unrevoked instances and stopped at the limit,
// where the expiry indexes would read every tenant's lapsed rows and sort them.
function lapsed(now: Date) {
  return and(
    isNull(agentInstances.revokedAt),
    sql`least(${agentInstances.expiresAt}, coalesce(${agentInstances.idleExpiresAt}, ${agentInstances.expiresAt})) <= ${now.toISOString()}::timestamptz`,
  );
}

const children = alias(agentInstances, 'children');

// The deepest chain an instance can sit in, which bounds how many leaf-first
// rounds a tombstone pass needs.
const MAX_ROUNDS = 8;

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
          ...(input.slice === undefined
            ? {}
            : { sliceMutating: input.slice.mutating, sliceCreates: input.slice.creates }),
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

    // A page of the tenant's instances in id order, which is the order they
    // were minted in, so a parent comes before its children. Each filter has an
    // index that starts with the tenant: the tenant and id alone, with the owner,
    // or with whether the instance is revoked, so a page reads a page.
    async page(filter: AgentInstancePageFilter): Promise<AgentInstanceRecord[]> {
      const state = filter.state;
      return tx
        .select()
        .from(agentInstances)
        .where(
          and(
            filter.ownerSubjectId === undefined
              ? undefined
              : eq(agentInstances.ownerSubjectId, filter.ownerSubjectId),
            filter.afterId === undefined ? undefined : gt(agentInstances.id, filter.afterId),
            state === 'revoked' ? isNotNull(agentInstances.revokedAt) : undefined,
            state === 'live' ? live(filter.now) : undefined,
            state === 'expired' ? lapsed(filter.now) : undefined,
          ),
        )
        .orderBy(asc(agentInstances.id))
        .limit(filter.limit);
    },

    // The instance and every instance minted beneath it, revoked or not.
    // `depth` is capped at 8, which bounds the walk.
    async subtree(id: string): Promise<string[]> {
      const rows = await tx.execute(sql`
        with recursive tree as (
          select id from agent_instances where id = ${id}
          union all
          select c.id from agent_instances c join tree t on c.parent_instance_id = t.id
        )
        select id from tree`);
      return (rows as unknown as { id: string }[]).map((row) => row.id);
    },

    async liveChildren(parentId: string, now: Date): Promise<number> {
      const rows = await tx
        .select({ n: count() })
        .from(agentInstances)
        .where(and(eq(agentInstances.parentInstanceId, parentId), live(now)));
      return rows[0]?.n ?? 0;
    },

    // Takes the row lock a mint serialises on, so the children counted next
    // are the children that exist once this transaction commits.
    async lockForUpdate(id: string): Promise<AgentInstanceRecord | null> {
      const rows = await tx
        .select()
        .from(agentInstances)
        .where(eq(agentInstances.id, id))
        .for('update');
      return rows[0] ?? null;
    },

    // The same lock for an instance minted straight under a grant, which has
    // no parent instance row to take it on.
    async lockGrant(grantId: string): Promise<boolean> {
      const rows = await tx.execute(
        sql`select id from token_grants where id = ${grantId} for no key update`,
      );
      return (rows as unknown as unknown[]).length > 0;
    },

    async liveRoots(rootGrantId: string, now: Date): Promise<number> {
      const rows = await tx
        .select({ n: count() })
        .from(agentInstances)
        .where(
          and(
            eq(agentInstances.rootGrantId, rootGrantId),
            isNull(agentInstances.parentInstanceId),
            live(now),
          ),
        );
      return rows[0]?.n ?? 0;
    },

    // Every live instance of the tenant, counted on each mint. It reads at most
    // as many rows as the tenant may hold (`agent_max_live_instances`, 100,000
    // at the most), through the tenant's own index.
    async liveCount(now: Date): Promise<number> {
      const rows = await tx.select({ n: count() }).from(agentInstances).where(live(now));
      return rows[0]?.n ?? 0;
    },

    // Slides the idle expiry of an instance that has one, never backwards: a
    // request carrying an earlier `now` can take the lock after a later one. A
    // fixed-lifetime instance has nothing to slide, so it and a lapsed one
    // return false.
    async touch(id: string, now: Date, idleSeconds: number, sessionEndsAt: Date): Promise<boolean> {
      const rows = await tx
        .update(agentInstances)
        .set({
          idleExpiresAt: sql`least(greatest(idle_expires_at, ${now.toISOString()}::timestamptz + make_interval(secs => ${idleSeconds})), ${sessionEndsAt.toISOString()}::timestamptz)`,
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

    // Deletes the subject rows of the instances a removal is about to take with
    // it (the client they run as, their owners, or a grant they are rooted
    // at), and of every instance beneath those, which the instance rows then
    // follow by cascade. The walk is capped by the structural depth, and a
    // single statement does it however many instances there are.
    async removeWithSubjects(removal: {
      clientId: string | null;
      ownerIds: readonly string[];
    }): Promise<number> {
      const owners = JSON.stringify(removal.ownerIds);
      const rows = await tx.execute(sql`
        with recursive tree(id) as (
          select i.id from agent_instances i
           where i.owner_subject_id = any(array(select value::uuid from jsonb_array_elements_text(${owners}::jsonb)))
              or (${removal.clientId}::uuid is not null
                  and (i.agent_client_id = ${removal.clientId}::uuid
                       or i.root_grant_id in (select g.id from token_grants g where g.client_id = ${removal.clientId}::uuid)))
          union
          select c.id from agent_instances c join tree t on c.parent_instance_id = t.id
        )
        delete from subjects where id in (select id from tree) returning id`);
      return (rows as unknown as unknown[]).length;
    },

    // The instance and everything minted beneath it. `depth` is capped at 8,
    // which bounds the walk.
    async revoke(id: string, at: Date): Promise<number> {
      // The lineage is locked before any row of it, as a revoke's cascade does.
      await lockLineageRoots(
        tx,
        sql`
          with recursive tree(id) as (
            select id from agent_instances where id = ${id}
            union all
            select c.id from agent_instances c join tree t on c.parent_instance_id = t.id
          )
          select root_grant_id as id from agent_instances where id in (select id from tree)`,
      );
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

    // Revokes what lapsed and everything beneath it, as `revoke` does, then
    // deletes instances revoked before `tombstoneBefore` together with their
    // subjects. An instance is deleted only once it has no child left, so
    // deleting never cascades to a child that is still live or inside its
    // own tombstone window; the rounds remove a chain from the leaves up.
    async expireDue(
      now: Date,
      tombstoneBefore: Date,
    ): Promise<{ expired: number; deleted: number }> {
      await lockLineageRoots(
        tx,
        sql`
          with recursive tree(id) as (
            select id from agent_instances
             where revoked_at is null
               and (expires_at <= ${now.toISOString()}::timestamptz
                    or idle_expires_at <= ${now.toISOString()}::timestamptz)
            union all
            select c.id from agent_instances c join tree t on c.parent_instance_id = t.id
          )
          select root_grant_id as id from agent_instances where id in (select id from tree)`,
      );
      const expired = (await tx.execute(sql`
        with recursive tree as (
          select id from agent_instances
           where revoked_at is null
             and (expires_at <= ${now.toISOString()}::timestamptz
                  or idle_expires_at <= ${now.toISOString()}::timestamptz)
          union all
          select c.id from agent_instances c join tree t on c.parent_instance_id = t.id
        )
        update agent_instances set revoked_at = ${now.toISOString()}::timestamptz
         where id in (select id from tree) and revoked_at is null
        returning id`)) as unknown as unknown[];
      const removed: string[] = [];
      for (let round = 0; round < MAX_ROUNDS; round += 1) {
        const gone = await tx
          .delete(agentInstances)
          .where(
            and(
              isNotNull(agentInstances.revokedAt),
              lt(agentInstances.revokedAt, tombstoneBefore),
              notExists(
                tx
                  .select({ one: sql`1` })
                  .from(children)
                  .where(eq(children.parentInstanceId, agentInstances.id)),
              ),
            ),
          )
          .returning({ id: agentInstances.id });
        if (gone.length === 0) break;
        removed.push(...gone.map((row) => row.id));
      }
      if (removed.length > 0) {
        await tx.delete(subjects).where(inArray(subjects.id, removed));
      }
      return { expired: expired.length, deleted: removed.length };
    },
  };
}
