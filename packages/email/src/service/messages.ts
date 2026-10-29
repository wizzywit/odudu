import { createTranslators, type Messages, type Translators } from '@odudu/i18n';
import { escapeHtml } from '#/service/escape';
import { ar } from '#/service/messages.ar';

// Every sentence a mail says, keyed by what it is for. `en` is the source and
// complete; another locale may omit a key and shows English for it. A message
// is plain text: markup stays in the template, and the link is never a message.
export const en = {
  'mail.brand': 'odudu',
  'mail.copyright': '\u00a9 {year} Odudu',
  'mail.poweredBy': 'Powered by odudu',
  'mail.linkFallback': 'If the button does not work, copy this link into your browser:',
  'mail.notRequested': 'If you did not request this, you can ignore this message.',
  'verify.subject': 'Verify your {tenant} account',
  'verify.preheader': 'Confirm your email address to finish setting up your account.',
  'verify.heading': 'Verify your email address',
  'verify.text': 'Confirm your email address for {tenant} by visiting this link:',
  'verify.body': 'Confirm that this is your email address for your {tenant} account.',
  'verify.button': 'Verify email',
  'verify.reason':
    'You received this because this email address was used to create or update an account at {tenant}.',
  'finish.subject': 'Finish creating your {tenant} account',
  'finish.preheader': 'Open the link to finish creating your account.',
  'finish.heading': 'Finish creating your account',
  'finish.text':
    'Someone asked to create a {tenant} account with this address. If it was you, open this link to finish:',
  'finish.body':
    'Someone asked to create a {tenant} account with this address. If it was you, open the link to finish.',
  'finish.button': 'Finish sign-up',
  'finish.reason':
    'You received this because this email address was used to start an account at {tenant}.',
  'duplicate.subject': 'You already have a {tenant} account',
  'duplicate.preheader': 'Someone tried to register this email address. You can sign in.',
  'duplicate.heading': 'You already have an account',
  'duplicate.text':
    'Someone tried to create a {tenant} account with this email address. You already have one.',
  'duplicate.next': 'If it was you, sign in. If you forgot your password, reset it.',
  'duplicate.nextSignIn':
    'If it was you, sign in. If you forgot your password, ask your administrator.',
  'duplicate.button': 'Reset password',
  'duplicate.reason':
    'You received this because this email address was used to register at {tenant}.',
  'reset.subject': 'Reset your {tenant} password',
  'reset.preheader': 'Use the link inside to choose a new password.',
  'reset.heading': 'Reset your password',
  'reset.text': 'Reset your password for {tenant} by visiting this link:',
  'reset.body': 'We received a request to reset your password for {tenant}.',
  'reset.button': 'Reset password',
  'reset.reason':
    'You received this because a password reset was requested for this email address at {tenant}.',
  'actions.subject': 'Update your {tenant} account',
  'actions.preheader': 'Your administrator has asked you to make a change to your account.',
  'actions.heading': 'Update your account',
  'actions.text': 'Your administrator asks you to update your {tenant} account:',
  'actions.textLink': 'Do so by visiting this link:',
  'actions.button': 'Update account',
  'actions.ignore': 'If you were not expecting this, you can ignore this message.',
  'actions.reason':
    'You received this because an administrator at {tenant} asked you to update your account.',
  'notice.contact': 'If you did not expect this, contact your administrator.',
  'factorRemoved.subject': 'A sign-in method was removed from your {tenant} account',
  'factorRemoved.preheader': 'An administrator changed how you sign in to your account.',
  'factorRemoved.heading': 'A sign-in method was removed',
  'factorRemoved.totp':
    'An administrator removed the authenticator app from your {tenant} account.',
  'factorRemoved.webauthn': 'An administrator removed a passkey from your {tenant} account.',
  'factorRemoved.codes': 'Your recovery codes were removed with it, and no longer work.',
  'factorRemoved.reason':
    'You received this because a sign-in method on your account at {tenant} was changed.',
  'recoveryRevoked.subject': 'Your {tenant} recovery codes were revoked',
  'recoveryRevoked.preheader': 'An administrator revoked your recovery codes.',
  'recoveryRevoked.heading': 'Your recovery codes were revoked',
  'recoveryRevoked.text':
    'An administrator revoked the recovery codes on your {tenant} account. The old codes no longer work.',
  'recoveryRevoked.newSet': 'You will be asked to save a new set the next time you sign in.',
  'recoveryRevoked.reason':
    'You received this because the recovery codes on your account at {tenant} were changed.',
  'smtpTest.subject': 'Odudu SMTP test',
  'smtpTest.preheader': 'This message was sent to check the mail settings.',
  'smtpTest.heading': 'SMTP test',
  'smtpTest.text': 'This is a test message from Odudu.',
  'smtpTest.reason':
    'You received this because a test message was sent from the mail settings of {tenant}.',
  'action.update-password': 'Choose a new password',
  'action.configure-totp': 'Set up an authenticator app',
  'action.configure-passkey': 'Register a passkey',
  'action.generate-recovery-codes': 'Save a set of recovery codes',
};

// The English text of every mail message: the keys a tenant's override may
// name and, for each, the arguments the mail supplies.
export const MAIL_MESSAGES: Readonly<Record<string, string>> = en;

export function isMailMessageKey(key: string): boolean {
  return Object.hasOwn(en, key);
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
