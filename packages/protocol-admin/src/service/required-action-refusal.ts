import { type RequiredAction } from '@odudu/contracts/admin';

// What the refusal reads of the subject and the tenant, by what it was read
// from. A source is present only where an action in the list depends on it.
export interface RequiredActionSources {
  // The subject's address; null when it has none.
  readonly email?: string | null;
  // The tenant's terms address; null when it has none.
  readonly termsUri?: string | null;
  // The claims the tenant needs a person to have, and the fields a person may
  // edit there.
  readonly requiredProfileFields?: readonly string[];
  readonly editableProfileFields?: readonly string[];
}

export type RequiredActionRefusal =
  'no_email' | 'no_editable_profile_fields' | 'terms_not_configured';

// The actions of a request that the subject does not already owe: only these
// are judged, so a list that keeps an action which has since become impossible
// can still be saved.
export function addedActions(
  current: readonly RequiredAction[],
  requested: readonly RequiredAction[],
): RequiredAction[] {
  return requested.filter((action) => !current.includes(action));
}

// Which reads a list needs before it can be judged.
export function readsNeeded(actions: readonly RequiredAction[]): {
  user: boolean;
  tenant: boolean;
} {
  return {
    user: actions.includes('verify-email'),
    tenant: actions.includes('accept-terms') || actions.includes('update-profile'),
  };
}

// Why an action cannot be owed to this subject at this tenant, or null: an
// address that is not there cannot be verified, a profile whose required fields
// a person may not edit cannot be completed, and terms the tenant has not
// published cannot be accepted. In the order a sign-in asks for the actions.
export function requiredActionRefusal(
  actions: readonly RequiredAction[],
  sources: RequiredActionSources,
): RequiredActionRefusal | null {
  if (actions.includes('verify-email') && sources.email === null) return 'no_email';
  if (actions.includes('update-profile') && !requiredFieldsEditable(sources)) {
    return 'no_editable_profile_fields';
  }
  if (actions.includes('accept-terms') && sources.termsUri === null) {
    return 'terms_not_configured';
  }
  return null;
}

function requiredFieldsEditable(sources: RequiredActionSources): boolean {
  const editable = sources.editableProfileFields;
  const required = sources.requiredProfileFields;
  if (editable === undefined || required === undefined) return true;
  return required.every((field) => editable.includes(field));
}
