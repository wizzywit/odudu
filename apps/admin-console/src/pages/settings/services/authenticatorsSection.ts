import { authenticatorOptions } from '#/shared/lib/services/authenticatorChoices';
import type { SettingsSection } from '#/pages/settings/services/sectionTypes';

export const AUTHENTICATORS_SECTION = 'authenticators';

export const AUTHENTICATORS: SettingsSection = {
  id: AUTHENTICATORS_SECTION,
  title: 'Authenticators',
  description:
    'What a new authenticator app, passkey or recovery set is made with, and whether sign-in asks everyone for a passkey. One already enrolled keeps the values it was made with.',
  fields: [
    {
      name: 'totp_algorithm',
      label: 'Authenticator app algorithm',
      control: 'choice',
      description:
        'SHA1 works in every authenticator app. A person’s app must support another algorithm, digit count and period before they can use it; the enrolment page says so.',
      options: authenticatorOptions('totp_algorithm'),
    },
    {
      name: 'totp_digits',
      label: 'Authenticator app code length',
      control: 'choice',
      numeric: true,
      options: authenticatorOptions('totp_digits'),
    },
    {
      name: 'totp_period',
      label: 'Authenticator app code period',
      control: 'choice',
      numeric: true,
      options: authenticatorOptions('totp_period'),
    },
    {
      name: 'webauthn_user_verification',
      label: 'Passkey user verification',
      control: 'choice',
      description:
        'Whether a new passkey checks the person with a PIN or biometric. A passkey made without it signs in as one factor, so a second factor is still asked for.',
      options: authenticatorOptions('webauthn_user_verification'),
    },
    {
      name: 'webauthn_resident_key',
      label: 'Passkey stored on the device',
      control: 'choice',
      description:
        'A passkey that is not stored on the device cannot sign a person in who has not typed a username.',
      options: authenticatorOptions('webauthn_resident_key'),
    },
    {
      name: 'require_passkey',
      label: 'Require a passkey',
      control: 'toggle',
      description:
        'Does nothing where the deployment has no public base URL, or one that is an IP address, unless the tenant has a domain of its own: nobody is asked. A person without a passkey is asked to add one at their next sign-in and cannot skip it. Sessions already open are not touched. Turning this off does not clear an action already owed; clear it on the person’s record.',
    },
    {
      name: 'recovery_code_count',
      label: 'Recovery codes in a set',
      control: 'count',
      unit: 'codes',
      description: 'A set already issued keeps its size.',
    },
    {
      name: 'recovery_code_warn_below',
      label: 'Recovery code warning',
      control: 'count',
      unit: 'codes',
      description:
        'The credential list of the "me" API flags a person with fewer unspent recovery codes than this, so an application can ask them to issue a new set. 0 turns the flag off.',
    },
  ],
};
