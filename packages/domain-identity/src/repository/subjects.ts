import { type TenantScopedDatabase } from '@odudu/db';
import { newId, OduduError } from '@odudu/kernel';
import { eq, sql } from 'drizzle-orm';
import { subjects, type SubjectRecord } from '#/schema/subjects';

export type { SubjectRecord } from '#/schema/subjects';

function toRecord(row: typeof subjects.$inferSelect): SubjectRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type as SubjectRecord['type'],
    disabledAt: row.disabledAt,
  };
}

export interface NewSubject {
  tenantId: string;
  type: SubjectRecord['type'];
}

export function subjectRepository(tx: TenantScopedDatabase) {
  return {
    async byId(id: string): Promise<SubjectRecord | null> {
      const rows = await tx.select().from(subjects).where(eq(subjects.id, id));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // Used when provisioning a confidential client's service subject, and by
    // the user repository's registration path.
    async create(input: NewSubject): Promise<SubjectRecord> {
      const rows = await tx
        .insert(subjects)
        .values({ id: newId(), tenantId: input.tenantId, type: input.type })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new Error('insert into subjects returned no row');
      }
      return toRecord(row);
    },

    // Enabling and disabling both go through `disabled_at`, never a second
    // boolean column: a timestamp answers "since when" for free, which a
    // caller reading `enabled: false` back from the admin API has no other
    // way to learn.
    // A repeated `false` is a no-op on the timestamp: disabled_at records
    // since when, and COALESCE keeps the first disable's value rather than
    // sliding it forward on every later PATCH.
    async setEnabled(id: string, enabled: boolean): Promise<SubjectRecord> {
      const rows = await tx
        .update(subjects)
        .set({
          disabledAt: enabled ? null : sql`coalesce(${subjects.disabledAt}, now())`,
        })
        .where(eq(subjects.id, id))
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('subject_not_found', `no subject with id ${id}`);
      }
      return toRecord(row);
    },
  };
}
