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
  | { kind: 'accepted' }
  | { kind: 'not_accepted' }
  | { kind: 'not_configured' }
  // The terms changed since the page was shown, or the form did not say which
  // it showed: nothing is recorded.
  | { kind: 'stale' };

export interface AcceptTerms {
  tenantId: string;
  subjectId: string;
  // Whether the box was ticked.
  accepted: boolean;
  // The version the page showed, as the form carried it back.
  version: string | undefined;
  now: Date;
}

// A person accepts the version they were shown: the form carries it back and it
// has to be the one in force now, which is the one recorded, so a person
// cannot accept terms they never saw.
export async function completeAcceptTerms(
  tx: TenantScopedDatabase,
  input: AcceptTerms,
): Promise<AcceptTermsOutcome> {
  const offer = await termsOffer(tx, input.tenantId);
  if (offer === null) return { kind: 'not_configured' };
  if (input.version !== offer.version) return { kind: 'stale' };
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
