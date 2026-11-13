import { and, asc, eq, sql } from 'drizzle-orm';
import { type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { type Flow, type FlowStep, flows } from '#/schema/flow';
import { DEFAULT_FLOW_NAME, flowStepsSchema, MAX_FLOWS_PER_TENANT } from '#/service/flow';

function toFlow(row: typeof flows.$inferSelect): Flow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    isDefault: row.isDefault,
    steps: flowStepsSchema.parse(row.steps),
  };
}

// All persistence for a tenant's sign-in flows. Choosing which flow a sign-in
// runs is `resolveFlow`; this is the bounded read it takes and the writes
// that keep the tenant's default.
export function flowRepository(tx: TenantScopedDatabase) {
  const lock = async (tenantId: string): Promise<void> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('flows'), hashtext(${tenantId}))`);
  };

  return {
    // Bounded by the per-tenant cap and served by the (tenant_id, name) index.
    async forTenant(tenantId: string): Promise<Flow[]> {
      const rows = await tx
        .select()
        .from(flows)
        .where(eq(flows.tenantId, tenantId))
        .orderBy(asc(flows.name))
        .limit(MAX_FLOWS_PER_TENANT);
      return rows.map(toFlow);
    },

    async byId(tenantId: string, id: string): Promise<Flow | null> {
      const [row] = await tx
        .select()
        .from(flows)
        .where(and(eq(flows.tenantId, tenantId), eq(flows.id, id)))
        .limit(1);
      return row === undefined ? null : toFlow(row);
    },

    // Counts at most the cap, so the read stays bounded however the table grows.
    async countForTenant(tenantId: string): Promise<number> {
      const rows = await tx
        .select({ id: flows.id })
        .from(flows)
        .where(eq(flows.tenantId, tenantId))
        .limit(MAX_FLOWS_PER_TENANT);
      return rows.length;
    },

    // A second flow of the name fails on `flows_tenant_name`; the caller maps it.
    async create(tenantId: string, name: string, steps: readonly FlowStep[]): Promise<Flow> {
      const [row] = await tx
        .insert(flows)
        .values({
          id: newId(),
          tenantId,
          name,
          isDefault: false,
          steps: flowStepsSchema.parse(steps),
        })
        .returning();
      if (row === undefined) throw new Error(`flow write returned no row for tenant ${tenantId}`);
      return toFlow(row);
    },

    async replace(
      tenantId: string,
      id: string,
      name: string,
      steps: readonly FlowStep[],
    ): Promise<Flow | null> {
      const [row] = await tx
        .update(flows)
        .set({ name, steps: flowStepsSchema.parse(steps), updatedAt: sql`now()` })
        .where(and(eq(flows.tenantId, tenantId), eq(flows.id, id)))
        .returning();
      return row === undefined ? null : toFlow(row);
    },

    // The partial unique index allows one default, so the old one is cleared
    // before the new one is set; the caller holds the tenant lock, and the
    // pair runs in one transaction. Null when the tenant has no such flow.
    async makeDefault(tenantId: string, id: string): Promise<Flow | null> {
      const target = await this.byId(tenantId, id);
      if (target === null) return null;
      if (target.isDefault) return target;
      await tx
        .update(flows)
        .set({ isDefault: false, updatedAt: sql`now()` })
        .where(and(eq(flows.tenantId, tenantId), eq(flows.isDefault, true)));
      const [row] = await tx
        .update(flows)
        .set({ isDefault: true, updatedAt: sql`now()` })
        .where(and(eq(flows.tenantId, tenantId), eq(flows.id, id)))
        .returning();
      return row === undefined ? null : toFlow(row);
    },

    // The default is never removed here: a tenant always has one.
    async remove(tenantId: string, id: string): Promise<boolean> {
      const rows = await tx
        .delete(flows)
        .where(and(eq(flows.tenantId, tenantId), eq(flows.id, id), eq(flows.isDefault, false)))
        .returning({ id: flows.id });
      return rows.length > 0;
    },

    // The flow a sign-in runs: the one named, else the tenant's default. One
    // query either way, the choice made by the predicate and not by the caller;
    // at most the tenant's 20 flows are looked at.
    async forSignIn(tenantId: string, flowId: string | null): Promise<Flow | null> {
      const [row] = await tx
        .select()
        .from(flows)
        .where(
          and(
            eq(flows.tenantId, tenantId),
            sql`(${flows.id} = ${flowId}::uuid or (${flowId}::uuid is null and ${flows.isDefault}))`,
          ),
        )
        .limit(1);
      return row === undefined ? null : toFlow(row);
    },

    async defaultForTenant(tenantId: string): Promise<Flow | null> {
      const [row] = await tx
        .select()
        .from(flows)
        .where(and(eq(flows.tenantId, tenantId), eq(flows.isDefault, true)))
        .limit(1);
      return row === undefined ? null : toFlow(row);
    },

    // For a caller that reads the flow before deciding whether to replace
    // it: an `If-Match` comparison means nothing unless nothing else can
    // write between the read and the write. Re-taking it below costs
    // nothing, pg_advisory_xact_lock being reentrant within a transaction.
    lockForTenant: lock,

    // Writes the whole list of the tenant's default flow, creating the row
    // when the tenant has none. The default is found by `is_default`, never by
    // name, so renaming it or another flow taking `default` does not matter. A flow's meaning is in its order, so a step
    // is never edited alone. The advisory lock serialises two concurrent
    // replacements; the partial unique index would fail the second insert.
    async replaceDefaultSteps(tenantId: string, steps: readonly FlowStep[]): Promise<Flow> {
      await lock(tenantId);
      const valid = flowStepsSchema.parse(steps);
      const [updated] = await tx
        .update(flows)
        .set({ steps: valid, updatedAt: sql`now()` })
        .where(and(eq(flows.tenantId, tenantId), eq(flows.isDefault, true)))
        .returning();
      if (updated !== undefined) return toFlow(updated);
      const [row] = await tx
        .insert(flows)
        .values({
          id: newId(),
          tenantId,
          name: DEFAULT_FLOW_NAME,
          isDefault: true,
          steps: valid,
        })
        .returning();
      if (row === undefined) throw new Error(`flow write returned no row for tenant ${tenantId}`);
      return toFlow(row);
    },
  };
}
