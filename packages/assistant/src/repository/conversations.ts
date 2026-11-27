import { MAX_LIMIT } from '@odudu/contracts/admin';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { assistantConversations, type ConversationRecord } from '#/schema/assistant-conversations';
import { type AssistantTx } from '#/repository/tx';
import type { ActivityPosition } from '#/service/activity-rows';

export type { ConversationRecord } from '#/schema/assistant-conversations';

export type ConversationMode = 'ask' | 'act';

export interface NewConversation {
  id: string;
  tenantId: string;
  ownerSubjectId: string;
  instanceId: string;
  profile: string;
  mode: ConversationMode;
  // The tenant the conversation acts in, when it is not `tenantId`; omitted otherwise.
  targetTenantId?: string;
  now: Date;
}

// One row of a person's list: what the list shows, and where to resume from.
export interface ConversationListRow {
  id: string;
  title: string | null;
  profile: string;
  mode: string;
  createdAt: Date;
  lastActiveAt: Date;
  archivedAt: Date | null;
  reportedAt: Date | null;
  targetTenantId: string | null;
  position: ActivityPosition;
}

export interface ConversationList {
  /** Which of the person's two lists: the hidden ones or the rest. */
  archived: boolean;
  /**
   * The tenant the list is for: null lists the owner's conversations in their own
   * tenant, a tenant id those made for that tenant, so a list never mixes the two.
   */
  target: string | null;
  /** The tenant that holds the conversations, bound as a value so the index can serve the order. */
  tenant: string;
  after?: ActivityPosition | undefined;
  limit: number;
}

export interface ConversationPage {
  items: ConversationListRow[];
  next: ActivityPosition | null;
}

interface ListRow extends Record<string, unknown> {
  id: string;
  title: string | null;
  profile: string;
  mode: string;
  created_at: Date | string;
  last_active_at: Date | string;
  last_active_text: string;
  archived_at: Date | string | null;
  reported_at: Date | string | null;
  target_tenant_id: string | null;
}

const TENANT = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;

function listRowOf(row: ListRow): ConversationListRow {
  return {
    id: row.id,
    title: row.title,
    profile: row.profile,
    mode: row.mode,
    createdAt: new Date(row.created_at),
    lastActiveAt: new Date(row.last_active_at),
    archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
    reportedAt: row.reported_at === null ? null : new Date(row.reported_at),
    targetTenantId: row.target_tenant_id,
    position: { lastActiveAt: row.last_active_text, id: row.id },
  };
}

export function conversationRepository(tx: AssistantTx) {
  return {
    async create(input: NewConversation): Promise<ConversationRecord> {
      const [row] = await tx
        .insert(assistantConversations)
        .values({
          id: input.id,
          tenantId: input.tenantId,
          ownerSubjectId: input.ownerSubjectId,
          instanceId: input.instanceId,
          profile: input.profile,
          mode: input.mode,
          targetTenantId: input.targetTenantId ?? null,
          createdAt: input.now,
          lastActiveAt: input.now,
        })
        .returning();
      if (row === undefined) throw new Error('the conversation insert returned no row');
      return row;
    },

    async byId(id: string): Promise<ConversationRecord | undefined> {
      const [row] = await tx
        .select()
        .from(assistantConversations)
        .where(eq(assistantConversations.id, id))
        .limit(1);
      return row;
    },

    // Points the conversation at the grant a new sign-in made and at the run that
    // grant's instance belongs to. The generation must be the one the caller read
    // under the row lock, so a stale caller changes nothing.
    async rebind(
      id: string,
      change: { grantId: string; generation: number; instanceId: string },
      observed: number,
    ): Promise<boolean> {
      const rows = await tx
        .update(assistantConversations)
        .set({
          grantId: change.grantId,
          runGeneration: change.generation,
          instanceId: change.instanceId,
        })
        .where(
          and(
            eq(assistantConversations.id, id),
            eq(assistantConversations.runGeneration, observed),
          ),
        )
        .returning({ id: assistantConversations.id });
      return rows.length > 0;
    },

    // One person's conversations in one of their two lists, newest activity
    // first, served by the partial index of that list. The limit is bounded at
    // MAX_LIMIT whatever the caller passes; one extra row says whether a further
    // page exists. The time travels as the database prints it, so no precision
    // is lost between pages.
    async listByOwner(owner: string, list: ConversationList): Promise<ConversationPage> {
      const size = Number.isNaN(list.limit)
        ? 1
        : Math.max(1, Math.min(Math.trunc(list.limit), MAX_LIMIT));
      const after =
        list.after === undefined
          ? sql``
          : sql`and (c.last_active_at, c.id) < (${list.after.lastActiveAt}::timestamptz, ${list.after.id}::uuid)`;
      const target = sql`c.scope_tenant_id = ${list.target ?? list.tenant}::uuid`;
      const state = list.archived ? sql`c.archived_at is not null` : sql`c.archived_at is null`;
      const rows = await tx.execute<ListRow>(sql`
        select c.id, c.title, c.profile, c.mode, c.created_at, c.last_active_at,
               c.last_active_at::text as last_active_text, c.archived_at, c.reported_at,
               c.target_tenant_id
          from assistant_conversations c
         where c.tenant_id = ${TENANT} and c.owner_subject_id = ${owner}
           and ${state} and ${target} ${after}
         order by c.last_active_at desc, c.id desc
         limit ${size + 1}`);
      const items = rows.slice(0, size).map(listRowOf);
      const last = items[items.length - 1];
      return { items, next: rows.length > size && last !== undefined ? last.position : null };
    },

    // Hides the conversation from its owner's list, or brings it back. Hiding
    // one that is hidden keeps the first time; nothing else about it changes.
    // Undefined for a conversation that is not here.
    async setArchived(id: string, archived: boolean, now: Date): Promise<Date | null | undefined> {
      const rows = await tx.execute<{ archived_at: Date | string | null }>(sql`
        update assistant_conversations
           set archived_at = ${
             archived ? sql`coalesce(archived_at, ${now.toISOString()}::timestamptz)` : sql`null`
           }
         where tenant_id = ${TENANT} and id = ${id}
        returning archived_at`);
      const [row] = rows;
      if (row === undefined) return undefined;
      return row.archived_at === null ? null : new Date(row.archived_at);
    },

    // Names the conversation once, from what was first asked in it.
    async setTitleOnce(id: string, title: string): Promise<void> {
      await tx
        .update(assistantConversations)
        .set({ title })
        .where(and(eq(assistantConversations.id, id), isNull(assistantConversations.title)));
    },

    // Takes the row's lock, which every write to the conversation takes, so a
    // delete waits for a write in flight and a write waits for the delete, and
    // two messages at once that find the grant ended make one new grant between them.
    async lock(id: string): Promise<ConversationRecord | undefined> {
      const [row] = await tx
        .select()
        .from(assistantConversations)
        .where(eq(assistantConversations.id, id))
        .for('update');
      return row;
    },

    async touch(id: string, now: Date): Promise<boolean> {
      const rows = await tx
        .update(assistantConversations)
        .set({
          lastActiveAt: sql`greatest(${assistantConversations.lastActiveAt}, ${now.toISOString()}::timestamptz)`,
        })
        .where(eq(assistantConversations.id, id))
        .returning({ id: assistantConversations.id });
      return rows.length > 0;
    },

    // Moves the conversation to the next run once, from the generation the caller
    // saw lapse: a caller that lost the race to another gets the generation that
    // won, not a second bump. The new run's instance id is stored with it.
    async advanceRun(
      id: string,
      observed: number,
      instanceIdOf: (generation: number) => string,
    ): Promise<number | undefined> {
      const next = observed + 1;
      const rows = await tx
        .update(assistantConversations)
        .set({ runGeneration: next, instanceId: instanceIdOf(next) })
        .where(
          and(
            eq(assistantConversations.id, id),
            eq(assistantConversations.runGeneration, observed),
          ),
        )
        .returning({ generation: assistantConversations.runGeneration });
      if (rows[0] !== undefined) return rows[0].generation;
      return (await this.byId(id))?.runGeneration;
    },

    async setMode(id: string, mode: ConversationMode): Promise<boolean> {
      const rows = await tx
        .update(assistantConversations)
        .set({ mode })
        .where(eq(assistantConversations.id, id))
        .returning({ id: assistantConversations.id });
      return rows.length > 0;
    },
  };
}
