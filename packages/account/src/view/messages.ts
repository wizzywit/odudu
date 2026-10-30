import { createTranslators, type Messages, type Translators } from '@odudu/i18n';
import { escapeHtml } from '#/view/document';
import { ar } from '#/view/messages.ar';

// Every sentence an account page shows, keyed by what it is for. `en` is the
// source and complete; another locale may omit a key and shows English for
// it. A message is plain text: markup stays in the renderer.
export const en = {
  'link.backToSignIn': 'Back to sign in',
  'link.continueToSignIn': 'Continue to sign in',
  'link.tryAgain': 'Try again',
  'link.registerAgain': 'Register again',
  'link.requestNewResetLink': 'Request a new link',
  'verification.succeeded.title': 'Email confirmed',
  'verification.succeeded.heading': 'Your email address is confirmed',
  'verification.succeeded.next':
    'Return to the application you were signing in to and sign in again.',
  'verification.failed.title': "Can't verify this link",
  'verification.failed.heading': "This link can't be used",
  'verification.failed.reason':
    'It may have already been used, expired, or no longer matches your email address. Request a new verification email and try again.',
  'confirm.verify.button': 'Confirm email',
  'confirm.title': 'Confirm your email address',
  'confirm.account': 'Account name: {username}',
  'confirm.next': 'Press the button to confirm this address.',
  'confirm.button': 'Confirm my email',
  'registration.title': 'Create account',
  'registration.username': 'Username',
  'registration.email': 'Email',
  'registration.password': 'Password',
  'registration.passwordConfirm': 'Confirm password',
  'registration.submit': 'Create account',
  'registration.failed.title': "Can't create this account",
  'registration.usernameGone.title': "Can't finish registering",
  'registration.usernameGone.next':
    'That username is no longer available. Register again with another one.',
  'registration.refusal.confirmRequired': 'Enter the password again.',
  'registration.refusal.passwordMismatch': "The passwords don't match.",
  'registration.refusal.usernameRequired': 'Enter a username.',
  'registration.refusal.emailRequired': 'Enter an email address.',
  'registration.refusal.passwordRequired': 'Enter a password.',
  'registration.refusal.emailTaken': 'That email address is already registered.',
  'registration.refusal.usernameTaken': 'That username is already taken.',
  'registration.refusal.invalidEmail': 'That is not an address the email claim may carry.',
  'registration.refusal.invalidUsername':
    'That username contains a character that changes the direction of text, which is not allowed.',
  'registration.refusal.unavailable': 'Registration is temporarily unavailable. Try again later.',
  'registration.succeeded.title': 'Account created',
  'registration.check.title': 'Check your email',
  'registration.check.next': 'If this address can be registered, we sent a link to finish.',
  'registration.ready.title': 'Your account is ready',
  'registration.ready.next': 'Return to the application you were signing in to and sign in.',
  'registration.succeeded.signIn': 'You can now sign in.',
  'password.rule.minLength':
    'Password must be at least {min, number, ::group-off} characters long.',
  'password.rule.maxLength': 'Password must be at most {max, number, ::group-off} characters long.',
  'password.rule.requireDigit': 'Password must contain a digit.',
  'password.rule.requireUppercase': 'Password must contain an uppercase letter.',
  'password.rule.requireLowercase': 'Password must contain a lowercase letter.',
  'password.rule.requireSpecial': 'Password must contain a special character.',
  'password.rule.notUsername': 'Password must not contain the username.',
  'password.rule.notEmail': 'Password must not contain the email address.',
  'password.hint.heading': 'Your password needs:',
  'password.hint.minLength': 'At least {min, number, ::group-off} characters',
  'password.hint.digit': 'A digit',
  'password.hint.uppercase': 'An uppercase letter',
  'password.hint.lowercase': 'A lowercase letter',
  'password.hint.special': 'A special character',
  'password.hint.notCommon': 'Not a common password',
  'password.hint.show': 'Show password',
  'password.hint.summary': '{met} of {total} rules met',
  'password.rule.common': 'That password is too easy to guess. Choose a different one.',
  'password.rule.notReused': 'Password must not be one you have used before.',
  'reset.request.title': 'Forgot your password?',
  'reset.request.email': 'Email',
  'reset.request.submit': 'Send reset link',
  'reset.requested.title': 'Check your email',
  'reset.requested.next':
    "If that address has an account, we've sent a link to reset its password.",
  'reset.requestFailed.title': "Can't send a reset link",
  'reset.requestFailed.emailRequired': 'Email is required.',
  'reset.requestFailed.unavailable': 'Password reset is temporarily unavailable. Try again later.',
  'reset.form.title': 'Choose a new password',
  'reset.form.newPassword': 'New password',
  'reset.form.submit': 'Reset password',
  'reset.succeeded.title': 'Password reset',
  'reset.succeeded.heading': 'Your password has been reset',
  'reset.succeeded.next':
    'Return to the application you were signing in to and sign in with your new password.',
  'reset.succeeded.nextWithLink': 'Sign in with your new password.',
  'reset.succeeded.factorsRemoved':
    'We removed the authenticator app, passkeys and recovery codes on this account. Set them up again after you sign in.',
  'reset.linkFailed.title': "Can't use this link",
  'reset.linkFailed.heading': "This link can't be used",
  'reset.linkFailed.reason':
    'It may have already been used or expired. Request a new one and try again.',
  'reset.required.reason': 'A new password is required.',
  'requiredActions.title': 'Update your account',
  'requiredActions.intro': 'Your administrator asks you to:',
  'requiredActions.newPassword': 'New password',
  'requiredActions.continue': 'Continue',
  'requiredActions.action.updatePassword': 'Choose a new password',
  'requiredActions.action.configureTotp': 'Set up an authenticator app',
  'requiredActions.action.configurePasskey': 'Register a passkey',
  'requiredActions.action.generateRecoveryCodes': 'Save a set of recovery codes',
  'requiredActions.succeeded.title': 'Account updated',
  'requiredActions.succeeded.heading': 'Your account is updated',
  'requiredActions.succeeded.close':
    'Return to the application you were signing in to and sign in again.',
  'requiredActions.succeeded.finish': 'Sign in to the application to finish:',
};

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
