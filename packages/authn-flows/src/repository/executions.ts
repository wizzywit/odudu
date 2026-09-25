import { asc, eq, sql } from 'drizzle-orm';
import { type TenantScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import {
  authenticationExecutions,
  type AuthenticationExecutionRecord,
  type Requirement,
} from '#/schema/execution';

function toRecord(
  row: typeof authenticationExecutions.$inferSelect,
): AuthenticationExecutionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    index: row.index,
    authenticator: row.authenticator,
    requirement: row.requirement,
  };
}

export interface NewAuthenticationExecution {
  tenantId: string;
  index: number;
  authenticator: string;
  requirement: Requirement;
}

/** An execution with no `index`: `replaceForTenant` assigns it from array order. */
export interface ExecutionInput {
  authenticator: string;
  requirement: Requirement;
}

// All persistence for a tenant's flat authentication flow. Evaluating it
// into a decision for a given subject is a later task; this is only the
// ordered read `forTenant` gives and the write that seeds it.
export function executionRepository(tx: TenantScopedDatabase) {
  return {
    async forTenant(tenantId: string): Promise<AuthenticationExecutionRecord[]> {
      const rows = await tx
        .select()
        .from(authenticationExecutions)
        .where(eq(authenticationExecutions.tenantId, tenantId))
        .orderBy(asc(authenticationExecutions.index));
      return rows.map(toRecord);
    },

    async create(input: NewAuthenticationExecution): Promise<void> {
      await tx.insert(authenticationExecutions).values({
        id: newId(),
        tenantId: input.tenantId,
        index: input.index,
        authenticator: input.authenticator,
        requirement: input.requirement,
      });
    },

    // Deletes and re-inserts in the caller's own transaction, never
    // partially: a flow's meaning is in its order.
    //
    // The advisory lock, not the row lock, is what serialises two
    // concurrent replacements: a tenant whose flow is empty has no rows to
    // lock, so both would reach the insert and
    // `authentication_executions_order` would fail one.
    async replaceForTenant(
      tenantId: string,
      steps: readonly ExecutionInput[],
    ): Promise<AuthenticationExecutionRecord[]> {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('authentication_executions'), hashtext(${tenantId}))`,
      );

      await tx
        .select({ id: authenticationExecutions.id })
        .from(authenticationExecutions)
        .where(eq(authenticationExecutions.tenantId, tenantId))
        .for('update');

      await tx
        .delete(authenticationExecutions)
        .where(eq(authenticationExecutions.tenantId, tenantId));

      const rows = steps.map((step, index) => ({
        id: newId(),
        tenantId,
        index,
        authenticator: step.authenticator,
        requirement: step.requirement,
      }));
      if (rows.length > 0) {
        await tx.insert(authenticationExecutions).values(rows);
      }
      return rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        index: row.index,
        authenticator: row.authenticator,
        requirement: row.requirement,
      }));
    },
  };
}
