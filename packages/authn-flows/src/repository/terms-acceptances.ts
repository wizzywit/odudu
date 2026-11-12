import { and, desc, eq, sql } from 'drizzle-orm';
import { type TenantScopedDatabase } from '@odudu/db';
import { subjectTermsAcceptances } from '#/schema/terms-acceptances';

// Both methods are a probe of the primary key, so neither reads more than one
// row however many versions a subject has accepted.
export function termsAcceptanceRepository(tx: TenantScopedDatabase) {
  return {
    // Idempotent: a second acceptance of a version keeps the first.
    async accept(
      tenantId: string,
      subjectId: string,
      version: string,
      acceptedAt?: Date,
    ): Promise<void> {
      await tx
        .insert(subjectTermsAcceptances)
        .values({
          tenantId,
          subjectId,
          version,
          ...(acceptedAt === undefined ? {} : { acceptedAt }),
        })
        .onConflictDoNothing();
    },

    // The subject's acceptances, newest first, after the one named; served by
    // the index on (tenant, subject, accepted_at, version).
    async recent(
      subjectId: string,
      page: { after: { acceptedAt: Date; version: string } | undefined; limit: number },
    ): Promise<{ version: string; acceptedAt: Date }[]> {
      return tx
        .select({
          version: subjectTermsAcceptances.version,
          acceptedAt: subjectTermsAcceptances.acceptedAt,
        })
        .from(subjectTermsAcceptances)
        .where(
          and(
            eq(subjectTermsAcceptances.subjectId, subjectId),
            page.after === undefined
              ? undefined
              : sql`(${subjectTermsAcceptances.acceptedAt}, ${subjectTermsAcceptances.version}) < (${page.after.acceptedAt.toISOString()}::timestamptz, ${page.after.version})`,
          ),
        )
        .orderBy(desc(subjectTermsAcceptances.acceptedAt), desc(subjectTermsAcceptances.version))
        .limit(page.limit);
    },

    async hasAccepted(subjectId: string, version: string): Promise<boolean> {
      const rows = await tx
        .select({ version: subjectTermsAcceptances.version })
        .from(subjectTermsAcceptances)
        .where(
          and(
            eq(subjectTermsAcceptances.subjectId, subjectId),
            eq(subjectTermsAcceptances.version, version),
          ),
        );
      return rows.length > 0;
    },
  };
}
