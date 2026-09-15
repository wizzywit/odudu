import { asc, eq } from 'drizzle-orm';
import { type RealmScopedDatabase } from '@odudu/db';
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
    realmId: row.realmId,
    index: row.index,
    authenticator: row.authenticator,
    requirement: row.requirement,
  };
}

export interface NewAuthenticationExecution {
  realmId: string;
  index: number;
  authenticator: string;
  requirement: Requirement;
}

// All persistence for a realm's flat authentication flow. Evaluating it
// into a decision for a given subject is a later task; this is only the
// ordered read `forRealm` gives and the write that seeds it.
export function executionRepository(tx: RealmScopedDatabase) {
  return {
    async forRealm(realmId: string): Promise<AuthenticationExecutionRecord[]> {
      const rows = await tx
        .select()
        .from(authenticationExecutions)
        .where(eq(authenticationExecutions.realmId, realmId))
        .orderBy(asc(authenticationExecutions.index));
      return rows.map(toRecord);
    },

    async create(input: NewAuthenticationExecution): Promise<void> {
      await tx.insert(authenticationExecutions).values({
        id: newId(),
        realmId: input.realmId,
        index: input.index,
        authenticator: input.authenticator,
        requirement: input.requirement,
      });
    },
  };
}
