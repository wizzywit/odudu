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
    // when the tenant has none. A flow's meaning is in its order, so a step
    // is never edited alone. The advisory lock serialises two concurrent
    // replacements; the partial unique index would fail the second insert.
    async replaceDefaultSteps(tenantId: string, steps: readonly FlowStep[]): Promise<Flow> {
      await lock(tenantId);
      const [row] = await tx
        .insert(flows)
        .values({
          id: newId(),
          tenantId,
          name: DEFAULT_FLOW_NAME,
          isDefault: true,
          steps: flowStepsSchema.parse(steps),
        })
        .onConflictDoUpdate({
          target: flows.tenantId,
          targetWhere: eq(flows.isDefault, true),
          set: { steps: flowStepsSchema.parse(steps), updatedAt: sql`now()` },
        })
        .returning();
      if (row === undefined) throw new Error(`flow write returned no row for tenant ${tenantId}`);
      return toFlow(row);
    },
  };
}
