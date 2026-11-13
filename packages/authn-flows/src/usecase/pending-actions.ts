import { type TenantScopedDatabase } from '@odudu/db';
import { credentialRepository, userRepository } from '@odudu/domain-identity';
import { requiredActionRepository } from '#/repository/required-actions';
import { tenantSettingsRepository } from '#/repository/tenant-settings';
import { termsAcceptanceRepository } from '#/repository/terms-acceptances';
import { type RequiredAction } from '#/schema/required-action';
import { unfinishableActions, type OwedFacts } from '#/service/owed-actions';

// What decides whether an owed action can still be shown, read only for an
// action that is owed: a few rows by key, however many sign-ins ask.
async function factsFor(
  tx: TenantScopedDatabase,
  tenantId: string,
  subjectId: string,
  owed: readonly RequiredAction[],
): Promise<OwedFacts> {
  const facts: { -readonly [K in keyof OwedFacts]: OwedFacts[K] } = {};
  if (owed.includes('verify-email')) {
    const user = await userRepository(tx).bySubjectId(subjectId);
    facts.address = {
      present: (user?.email ?? null) !== null,
      verified: user?.emailVerified === true,
    };
  }
  if (owed.includes('accept-terms')) {
    const { termsUri, termsVersion } =
      await tenantSettingsRepository(tx).accountActionSettings(tenantId);
    facts.terms = {
      configured: termsUri !== null,
      accepted:
        termsUri !== null &&
        (await termsAcceptanceRepository(tx).hasAccepted(subjectId, termsVersion)),
    };
  }
  if (owed.includes('generate-recovery-codes')) {
    facts.recovery = {
      holdsTotp: (await credentialRepository(tx).recoveryStanding(subjectId)).hasTotp,
    };
  }
  return facts;
}

// What a subject still owes, for the gate that reads it. An action no page
// could finish is cleared here instead of refusing the sign-in for a page that
// cannot be shown: a set of recovery codes for somebody who holds no TOTP (it
// can be left behind by a revoke followed by the removal of the last TOTP, or
// asked for by an administrator of a subject with none), an address already
// proved or not there, terms the tenant has dropped or the person has accepted.
export async function pendingActionsFor(
  tx: TenantScopedDatabase,
  tenantId: string,
  subjectId: string,
): Promise<RequiredAction[]> {
  const owed = await requiredActionRepository(tx).pendingFor(subjectId);
  const gone = unfinishableActions(owed, await factsFor(tx, tenantId, subjectId, owed));
  for (const action of gone) await requiredActionRepository(tx).complete(subjectId, action);
  return owed.filter((action) => !gone.includes(action));
}
