import { type RequiredAction } from '#/schema/required-action';

// What decides whether an owed action can still be shown. A field is present
// only for an action that is owed, so a sign-in reads nothing it has no use for.
export interface OwedFacts {
  readonly address?: { readonly present: boolean; readonly verified: boolean };
  readonly terms?: { readonly configured: boolean; readonly accepted: boolean };
  // A set of recovery codes serves nothing without a TOTP to use them with.
  readonly recovery?: { readonly holdsTotp: boolean };
}

// Owed actions no page could finish, which a sign-in clears instead of being
// refused for: an address that is already proved or is not there, terms the
// tenant no longer has or the person already accepted at this version, and
// recovery codes for somebody who holds no TOTP.
export function unfinishableActions(
  owed: readonly RequiredAction[],
  facts: OwedFacts,
): RequiredAction[] {
  return owed.filter((action) => {
    if (action === 'verify-email' && facts.address !== undefined) {
      return !facts.address.present || facts.address.verified;
    }
    if (action === 'accept-terms' && facts.terms !== undefined) {
      return !facts.terms.configured || facts.terms.accepted;
    }
    if (action === 'generate-recovery-codes' && facts.recovery !== undefined) {
      return !facts.recovery.holdsTotp;
    }
    return false;
  });
}
