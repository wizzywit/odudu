import { and, eq } from 'drizzle-orm';
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
