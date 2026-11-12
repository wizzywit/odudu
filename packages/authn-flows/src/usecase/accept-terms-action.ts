import { type TenantScopedDatabase } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { requiredActionRepository } from '#/repository/required-actions';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { termsAcceptanceRepository } from '#/repository/terms-acceptances';

export interface TermsOffer {
  uri: string;
  version: string;
}

// The terms in force, or null where the tenant has none.
export async function termsOffer(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<TermsOffer | null> {
  const { termsUri, termsVersion } =
    await tenantSettingsRepository(tx).accountActionSettings(tenantId);
  return termsUri === null ? null : { uri: termsUri, version: termsVersion };
}

export type AcceptTermsOutcome =
  { kind: 'accepted' } | { kind: 'not_accepted' } | { kind: 'not_configured' };

export interface AcceptTerms {
  tenantId: string;
  subjectId: string;
  // Whether the box was ticked.
  accepted: boolean;
  now: Date;
}

// The version recorded is the one in force when the box is ticked, read here
// and not taken from the form, so a person cannot accept a version that was
// never offered.
export async function completeAcceptTerms(
  tx: TenantScopedDatabase,
  input: AcceptTerms,
): Promise<AcceptTermsOutcome> {
  const offer = await termsOffer(tx, input.tenantId);
  if (offer === null) return { kind: 'not_configured' };
  if (!input.accepted) return { kind: 'not_accepted' };
  await termsAcceptanceRepository(tx).accept(
    input.tenantId,
    input.subjectId,
    offer.version,
    input.now,
  );
  await requiredActionRepository(tx).complete(input.subjectId, 'accept-terms');
  await auditRepository(tx).record({
    eventType: 'credential',
    action: 'terms.accepted',
    outcome: 'allowed',
    actorSubjectId: input.subjectId,
    resourceType: 'subject',
    resourceId: input.subjectId,
    detail: { version: offer.version },
  });
  return { kind: 'accepted' };
}
