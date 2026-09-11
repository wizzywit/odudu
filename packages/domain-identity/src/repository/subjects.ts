import { type RealmScopedDatabase } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { subjects, type SubjectRecord } from '#/schema/subjects';

export type { SubjectRecord } from '#/schema/subjects';

function toRecord(row: typeof subjects.$inferSelect): SubjectRecord {
  return {
    id: row.id,
    realmId: row.realmId,
    type: row.type as SubjectRecord['type'],
    disabledAt: row.disabledAt,
  };
}

export interface NewSubject {
  realmId: string;
  type: SubjectRecord['type'];
}

export function subjectRepository(tx: RealmScopedDatabase) {
  return {
    async byId(id: string): Promise<SubjectRecord | null> {
      const rows = await tx.select().from(subjects).where(eq(subjects.id, id));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // Used by Task 16's seed (a service subject for a confidential client)
    // and by the user repository's registration path.
    async create(input: NewSubject): Promise<SubjectRecord> {
      const rows = await tx
        .insert(subjects)
        .values({ id: newId(), realmId: input.realmId, type: input.type })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into subjects returned no row');
      }
      return toRecord(row);
    },
  };
}
