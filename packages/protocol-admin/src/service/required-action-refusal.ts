import { type RequiredAction } from '@odudu/contracts/admin';

// What decides whether an action can be owed at all. A field is read only for
// an action in the list that depends on it.
export interface RequiredActionFacts {
  readonly hasEmail?: boolean;
  readonly termsConfigured?: boolean;
  // How many profile fields a person may edit at the tenant.
  readonly editableProfileFields?: number;
}

export type RequiredActionRefusal =
  'no_email' | 'no_editable_profile_fields' | 'terms_not_configured';

// Why an action cannot be owed to this subject at this tenant, or null: an
// address that is not there cannot be verified, a profile with nothing to edit
// cannot be completed, and terms the tenant has not published cannot be
// accepted. In the order a sign-in asks for the actions.
export function requiredActionRefusal(
  actions: readonly RequiredAction[],
  facts: RequiredActionFacts,
): RequiredActionRefusal | null {
  if (actions.includes('verify-email') && facts.hasEmail === false) return 'no_email';
  if (actions.includes('update-profile') && facts.editableProfileFields === 0) {
    return 'no_editable_profile_fields';
  }
  if (actions.includes('accept-terms') && facts.termsConfigured === false) {
    return 'terms_not_configured';
  }
  return null;
}
