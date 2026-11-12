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
  'totp.parameters':
    'This authenticator uses {algorithm}, {digits, number, ::group-off} digits and a {period, number, ::group-off}-second period. Your app must support all three, or use a different one.',
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
  'refusal.passkeyNotDiscoverable':
    'That passkey is not stored on your device, so it cannot sign you in without a username. Add one that can be stored on the device.',

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
  'updatePassword.rule.breached':
    'That password has appeared in a data breach. Choose a different one.',
  'updatePassword.rule.breachCheckUnavailable':
    'The password could not be checked against known breaches. Try again in a moment.',
  'updatePassword.rule.superseded':
    'Your password was changed somewhere else before this form was submitted. Sign in again with the password you set there.',
  'updatePassword.currentPassword': 'Current password',
  'updatePassword.endOtherSessions': 'End my other sessions',
  'updatePassword.rule.currentPassword': 'The current password is not correct.',
  'action.cancel': 'Cancel and go back',
  'updatePassword.requestedIntro':
    'An application asked you to change your password. Enter your current password first.',
  'recoveryCodes.confirmReplace':
    'This replaces your current recovery codes. The old ones stop working as soon as you confirm.',
  'recoveryCodes.confirm': 'Replace my recovery codes',
  'recoveryCodes.confirmIssue':
    'This creates a set of recovery codes. Each signs you in once, in place of your second factor, if you lose it.',
  'recoveryCodes.confirmCreate': 'Create my recovery codes',
  'verifyEmail.title': 'Verify your email address',
  'verifyEmail.intro': 'This account needs a verified email address before you can continue.',
  'verifyEmail.requestedIntro': 'An application asked you to confirm your email address.',
  'verifyEmail.address': 'Address:',
  'verifyEmail.sendLink': 'Send me a link',
  'verifyEmail.confirm': 'I have verified it',
  'verifyEmail.sent':
    'We sent a link to this address. Open it, then come back and choose "I have verified it".',
  'verifyEmail.limited':
    'Links have been sent to this address several times already. Wait a while before asking for another.',
  'verifyEmail.unavailable':
    'This server cannot send mail right now. Ask an administrator to verify the address.',
  'verifyEmail.alreadyVerified': 'This address is already verified.',
  'verifyEmail.notVerified':
    'That address is not verified yet. Open the link we sent, then try again.',
  'updateProfile.title': 'Complete your profile',
  'updateProfile.intro': 'Fill in every field before you continue.',
  'updateProfile.requestedIntro': 'An application asked you to review your profile.',
  'updateProfile.submit': 'Save and continue',
  'updateProfile.unfilled': 'Fill in every field.',
  'updateProfile.usernameTaken': 'That username is taken. Choose another.',
  'updateProfile.invalid.value': '{field} is not in a form this field accepts.',
  'updateProfile.invalid.bidi': '{field} must not contain direction-control characters.',
  'updateProfile.invalid.birthdate': '{field} must be a date as YYYY-MM-DD, or a year as YYYY.',
  'updateProfile.invalid.zoneinfo': '{field} must be a time zone name such as Europe/London.',
  'updateProfile.invalid.locale': '{field} must be a language tag such as en or fr-CA.',
  'updateProfile.invalid.url': '{field} must be an address starting with http:// or https://.',
  'updateProfile.field.username': 'Username',
  'updateProfile.field.name': 'Full name',
  'updateProfile.field.givenName': 'Given name',
  'updateProfile.field.familyName': 'Family name',
  'updateProfile.field.middleName': 'Middle name',
  'updateProfile.field.nickname': 'Nickname',
  'updateProfile.field.preferredUsername': 'Preferred username',
  'updateProfile.field.profile': 'Profile page',
  'updateProfile.field.picture': 'Picture address',
  'updateProfile.field.website': 'Website',
  'updateProfile.field.gender': 'Gender',
  'updateProfile.field.birthdate': 'Birthdate',
  'updateProfile.field.zoneinfo': 'Time zone',
  'updateProfile.field.locale': 'Language',
  'updateProfile.field.phoneNumber': 'Phone number',
  'updateProfile.field.addressFormatted': 'Address',
  'updateProfile.field.addressStreet': 'Street',
  'updateProfile.field.addressLocality': 'City',
  'updateProfile.field.addressRegion': 'Region',
  'updateProfile.field.addressPostalCode': 'Postal code',
  'updateProfile.field.addressCountry': 'Country',
  'acceptTerms.title': 'Accept the terms',
  'acceptTerms.intro': 'Read the terms, then confirm that you accept them to continue.',
  'acceptTerms.link': 'Read the terms',
  'acceptTerms.version': 'Version {version}',
  'acceptTerms.accept': 'I accept these terms',
  'acceptTerms.submit': 'Continue',
  'acceptTerms.required': 'Tick the box to accept the terms and continue.',
  'recoveryCodes.tooSoon':
    'Your recovery codes were issued recently and still work. You can replace them in {minutes, plural, one {{minutes, number, ::group-off} minute} other {{minutes, number, ::group-off} minutes}}.',
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
