import { createTranslators, type Messages, type Translators } from '@odudu/i18n';
import { escapeHtml } from '#/view/document';
import { ar } from '#/view/messages.ar';

// Every sentence a page of this package shows, keyed by what it is for. `en`
// is the source and complete; another locale may omit a key and shows English
// for it. A message is plain text: markup stays in the renderer.
export const en = {
  'throttled.title': 'Too many attempts',
  'throttled.retryAfter':
    'Try again in {seconds, plural, one {{seconds, number, ::group-off} second} other {{seconds, number, ::group-off} seconds}}.',
  'throttled.goBack': 'Go back to the previous page when the time is up.',

  'notFound.title': 'Page not found',
  'notFound.body': 'There is nothing at this address.',
  'notFound.link.console': 'Open the console',
  'notFound.link.docs': 'Read the documentation',

  'serverError.title': 'Something went wrong',
  'serverError.body': 'The server could not complete this request. Try again in a moment.',
  'serverError.requestId': 'Request ID: {id}',

  'error.title': 'Sign-in error',
  'error.heading': "Can't continue",
  'error.wayOn.restart': 'Start sign-in again',
  'error.wayOn.return': 'Return to the application',
  'error.signInExpired': 'This sign-in attempt is no longer valid. Go back and start again.',
  'error.noPendingAction': 'This account has no such pending action.',
  'error.pendingActionNotReady': 'That pending action cannot be completed here yet.',
  'error.passwordTooLong': 'Password must be at most {max, number, ::group-off} characters long.',
  'error.unknownTenant': 'Unknown tenant.',
  'error.accountNotSignedIn': 'That account is not one this browser is currently signed in to.',

  'link.backToSignIn': 'Back to sign in',
  'emailUnverified.title': 'Verify your email',
  'emailUnverified.heading': "Can't sign in yet",
  'emailUnverified.body':
    '{mail, select, sent {We sent you a link to verify your email address. Open it, then sign in again.} other {You must verify your email to sign in, but this account has none. Ask an administrator.}}',

  'login.title': 'Sign in',
  'login.submit': 'Sign in',
  'login.context': 'to continue to {client}',
  'login.otp.title': 'Enter your authentication code',
  'login.recoveryCode.title': 'Enter a recovery code',
  'login.verify': 'Verify',
  'login.username': 'Username',
  'login.usernameOrEmail': 'Username or email',
  'login.password': 'Password',
  'login.otp.code': 'Code from your app',
  'login.recoveryCode.label': 'Or a recovery code',
  'login.rememberMe': 'Remember me',
  'login.unsupportedStep': 'Unsupported sign-in step: {form}',
  'login.passkey.submit': 'Sign in with a passkey',
  'login.passkey.needsScript':
    'Signing in with a passkey needs JavaScript, because only the browser can talk to your authenticator. Use your username and password above.',
  'login.passkey.failed': 'Your device did not finish signing in — {reason}. You can try again.',
  'login.passkey.cancelled': 'the request was cancelled',
  'login.passkey.notOffered': 'this server is not offering passkeys',
  'login.link.forgotPassword': 'Forgot password?',
  'login.link.createAccount': 'Create an account',
  'login.refusal.signInFailed': 'Sign-in failed. Check your details and try again.',
  'login.refusal.codeFailed': 'That code did not work. Check it and try again.',
  'login.refusal.recoveryCodeFailed': 'That recovery code did not work. Check it and try again.',
  'login.refusal.alreadyUsedRecoveryCode':
    'You have already used that recovery code. Try another one from your list.',

  'consent.title': 'Allow access?',
  'consent.heading': '{client} is asking for access',
  'consent.link.about': 'About {client}',
  'consent.link.privacy': 'Privacy policy',
  'consent.link.terms': 'Terms of service',
  'consent.scope.offlineAccess': '{label} — grants ongoing access, even while you are not present',
  'consent.allow': 'Allow',
  'consent.deny': 'Deny',

  'logout.confirm.title': 'Sign out?',
  'logout.confirm.body': 'Signing out ends this session for every application that uses it.',
  'logout.confirm.submit': 'Sign out',
  'logout.noSession.title': 'Already signed out',
  'logout.noSession.body': 'There is no active session to end.',
  'logout.done.title': 'Signed out',
  'logout.done.body': 'You have been signed out.',
  'logout.redirecting.body': 'You have been signed out. Taking you back to the app.',
  'logout.redirecting.continue': 'Continue',
  'logout.redirectRefused.body':
    'You have been signed out, but the address given to return to afterward is not one this client has registered, so it has not been used.',
  'logout.unauthenticated.title': "Can't sign out",
  'logout.unauthenticated.body': 'This sign-out attempt is no longer valid. Go back and try again.',

  'selectAccount.title': 'Choose an account',
  'selectAccount.useOther': 'Use another account',
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
