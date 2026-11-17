import { termsAcceptanceRepository } from '@odudu/authn-flows';
import { type TenantScopedDatabase } from '@odudu/db';
import { subjects } from '@odudu/domain-identity';
import { eq } from 'drizzle-orm';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';
import { acceptanceCursorOf, acceptanceFromCursor } from '#/service/terms-acceptance-cursor';

const COLLECTION = 'terms-acceptances';

export interface ListTermsAcceptancesInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
}

export interface ListedAcceptance {
  readonly version: string;
  readonly acceptedAt: Date;
}

export type ListTermsAcceptancesOutcome =
  | { kind: 'not_found' }
  | { kind: 'invalid_cursor' }
  | { kind: 'ok'; items: readonly ListedAcceptance[]; next: string | null };

export async function listTermsAcceptances(
  tx: TenantScopedDatabase,
  input: ListTermsAcceptancesInput,
): Promise<ListTermsAcceptancesOutcome> {
  const subjectRows = await tx
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.id, input.subjectId));
  if (subjectRows.length === 0) return { kind: 'not_found' };

  const filters = filterDigest({ subject: input.subjectId });
  let after: ReturnType<typeof acceptanceFromCursor>;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(
      input.cursorKey,
      COLLECTION,
      input.tenantId,
      filters,
      input.cursor,
    );
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    after = acceptanceFromCursor(decoded.after);
    if (after === undefined) return { kind: 'invalid_cursor' };
  }

  const rows = await termsAcceptanceRepository(tx).recent(input.subjectId, {
    after,
    limit: input.limit + 1,
  });
  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items[items.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: acceptanceCursorOf(last),
          collection: COLLECTION,
          tenantId: input.tenantId,
          filters,
        })
      : null;
  return { kind: 'ok', items, next };
}
