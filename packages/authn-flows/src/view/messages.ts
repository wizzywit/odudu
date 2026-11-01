import { createTranslators, type Messages, type Translators } from '@odudu/i18n';
import { escapeHtml } from '#/view/document';
import { ar } from '#/view/messages.ar';

// Every sentence an authn-flows page shows, keyed by what it is for. `en` is
// the source and complete; another locale may omit a key and shows English
// for it. A message is plain text: markup stays in the renderer.
export const en = {
  'totp.title': 'Set up your authenticator',
  'totp.scan': 'Scan this with your authenticator app, or enter the key by hand.',
  'totp.key': 'Key:',
  'totp.codeLabel': 'Code from your app',
  'totp.confirm': 'Confirm',
  'passkey.title': 'Add a passkey',
  'passkey.intro': 'Your device will ask you to confirm. Nothing is stored until it does.',
  'passkey.nameLabel': 'Name this passkey',
  'passkey.namePlaceholder': 'Passkey',
  'passkey.submit': 'Add passkey',
  'passkey.needsScript':
    'Adding a passkey needs JavaScript, because only the browser can talk to your authenticator.',
  'passkey.failed': 'Your device did not finish adding the passkey — {reason}. You can try again.',
  'passkey.cancelled': 'the request was cancelled',
  'recoveryCodes.title': 'Save your recovery codes',
  'recoveryCodes.use':
    'Each of these signs you in once, in place of your second factor, if you lose it.',
  'recoveryCodes.onlyTime': 'This is the only time they are shown.',
  'recoveryCodes.keep':
    'Print them or put them in a password manager before you continue — nobody, including an administrator, can show them to you again.',
  'recoveryCodes.replaced':
    'These replace the codes issued to this account before now, which no longer work.',
  'recoveryCodes.acknowledge': 'I have saved these codes',
  'link.backToSignIn': 'Back to sign in',
  'requiredAction.title': 'One more step',
  'requiredAction.pending':
    'This account has a pending action ({action}) that cannot be completed here yet.',
  'requiredAction.askAdmin': 'Ask an administrator to finish setting up this account.',
  'refusal.codeMismatch': 'That code did not match. Try the next one your app shows.',
  'refusal.codesNotSaved': 'Save these codes before continuing.',
  'refusal.passkeyNotAdded': 'That passkey could not be added. Try again.',

  'updatePassword.title': 'Change your password',
  'updatePassword.intro': 'This account needs a new password before you can continue.',
  'updatePassword.newPassword': 'New password',
  'updatePassword.submit': 'Update password',
  'updatePassword.rule.minLength':
    'Password must be at least {min, number, ::group-off} characters long.',
  'updatePassword.rule.maxLength':
    'Password must be at most {max, number, ::group-off} characters long.',
  'updatePassword.rule.requireDigit': 'Password must contain a digit.',
  'updatePassword.rule.requireUppercase': 'Password must contain an uppercase letter.',
  'updatePassword.rule.requireLowercase': 'Password must contain a lowercase letter.',
  'updatePassword.rule.requireSpecial': 'Password must contain a special character.',
  'updatePassword.rule.notUsername': 'Password must not contain the username.',
  'updatePassword.rule.notEmail': 'Password must not contain the email address.',
  'updatePassword.hint.heading': 'Your password needs:',
  'updatePassword.hint.minLength': 'At least {min, number, ::group-off} characters',
  'updatePassword.hint.digit': 'A digit',
  'updatePassword.hint.uppercase': 'An uppercase letter',
  'updatePassword.hint.lowercase': 'A lowercase letter',
  'updatePassword.hint.special': 'A special character',
  'updatePassword.hint.notCommon': 'Not a common password',
  'updatePassword.hint.show': 'Show password',
  'updatePassword.hint.summary': '{met} of {total} rules met',
  'updatePassword.rule.common': 'That password is too easy to guess. Choose a different one.',
  'updatePassword.rule.notReused': 'Password must not be one you have used before.',
  'updatePassword.rule.superseded':
    'Your password was changed somewhere else before this form was submitted. Sign in again with the password you set there.',
};

// A Latin token (a secret, a key URI, a recovery code) keeps its own
// left-to-right order inside a right-to-left page.
export function token(value: string): string {
  return `<bdi dir="ltr"><code>${escapeHtml(value)}</code></bdi>`;
}

export { ar };
export type MessageId = keyof typeof en;

export function translators(byLocale: Messages<typeof en>): Translators<typeof en> {
  return createTranslators(byLocale, escapeHtml);
}

const shipped = translators({ en, ar });

export const catalogue = shipped.catalogue;
export const t = shipped.t;
export const tHtml = shipped.tHtml;
export const bdi = shipped.bdi;
