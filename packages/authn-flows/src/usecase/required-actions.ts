import { type RequiredAction } from '#/schema/required-action';

// Two pending actions always run in the same sequence. An unproved address
// comes first, since proving it asks nothing of the person but the mailbox,
// then the password, so an expired password can never be used to enrol a
// second factor. The profile and the tenant's terms come last: nothing
// before them depends on either.
const REQUIRED_ACTION_ORDER: readonly RequiredAction[] = [
  'verify-email',
  'update-password',
  'configure-totp',
  'configure-passkey',
  'generate-recovery-codes',
  'update-profile',
  'accept-terms',
];

// The one thing that decides which pending action a login must complete
// next — null once none remain, which is what tells the login-submission
// gate it can proceed to completeLogin.
export function nextRequiredAction(pending: readonly RequiredAction[]): RequiredAction | null {
  const owed = new Set(pending);
  for (const action of REQUIRED_ACTION_ORDER) {
    if (owed.has(action)) return action;
  }
  return null;
}
