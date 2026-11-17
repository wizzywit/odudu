import { authenticatorOptions, authenticatorSettingWord } from '#/entities/authenticator';
import type { SettingField, SettingsSection } from '#/pages/settings/services/sectionTypes';

export const AUTHENTICATORS_SECTION = 'authenticators';
export const PASSKEY_REQUIREMENT_SECTION = 'passkey-requirement';

const APP = 'Authenticator app';
const PASSKEY = 'Passkeys';
const RECOVERY = 'Recovery codes';

function choice(name: string, group: string, rest: Partial<SettingField> = {}): SettingField {
  return {
    name,
    label: authenticatorSettingWord(name),
    control: 'choice',
    group,
    options: authenticatorOptions(name),
    ...rest,
  };
}

export const AUTHENTICATORS: SettingsSection = {
  id: AUTHENTICATORS_SECTION,
  title: 'Authenticators',
  description:
    'What a new authenticator app, passkey or recovery set is made with. One already enrolled keeps the values it was made with.',
  fields: [
    choice('totp_algorithm', APP, {
      description: 'SHA1 works in every authenticator app.',
      more: 'A person’s app must support another algorithm, digit count and period before they can use it; the enrolment page says so.',
    }),
    choice('totp_digits', APP, { numeric: true }),
    choice('totp_period', APP, { numeric: true }),
    choice('webauthn_user_verification', PASSKEY, {
      description: 'Whether a new passkey checks the person with a PIN or biometric.',
      more: 'A passkey made without it signs in as one factor, so a second factor is still asked for.',
    }),
    choice('webauthn_resident_key', PASSKEY, {
      description:
        'A passkey that is not stored on the device cannot sign in a person who has not typed a username.',
    }),
    {
      name: 'recovery_code_count',
      label: authenticatorSettingWord('recovery_code_count'),
      control: 'count',
      unit: 'codes',
      group: RECOVERY,
      description: 'A set already issued keeps its size.',
    },
    {
      name: 'recovery_code_warn_below',
      label: 'Warn when fewer than',
      control: 'count',
      unit: 'codes',
      group: RECOVERY,
      description:
        'An application can then ask the person to issue a new set. 0 turns the warning off.',
      more: 'The list of a person’s credentials, which an application reads for them, flags a person with fewer unspent recovery codes than this.',
    },
  ],
};

export const PASSKEY_REQUIREMENT: SettingsSection = {
  id: PASSKEY_REQUIREMENT_SECTION,
  title: 'Passkey requirement',
  description:
    'Whether sign-in asks everyone for a passkey. A person without one is asked to add one at their next sign-in and cannot skip it.',
  fields: [
    {
      name: 'require_passkey',
      label: 'Require a passkey',
      control: 'toggle',
      description: 'Sessions already open are not touched.',
      more: 'Does nothing where the deployment has no public base URL, or one that is an IP address, unless the tenant has a domain of its own: nobody is asked. Turning this off does not clear an action already owed; clear it on the person’s record.',
    },
  ],
};
