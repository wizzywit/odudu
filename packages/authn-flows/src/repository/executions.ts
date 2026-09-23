import { asc, eq } from 'drizzle-orm';
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
  };
}
