import { type RequiredAction } from '#/schema/required-action';

// Decision #2: two pending actions always run in the same sequence, and
// password comes first so an expired password can never be used to enrol a
// second factor.
const REQUIRED_ACTION_ORDER: readonly RequiredAction[] = [
  'update-password',
  'configure-totp',
  'configure-passkey',
  'generate-recovery-codes',
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
