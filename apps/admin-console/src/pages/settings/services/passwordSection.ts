import type { SettingsSection } from '#/pages/settings/services/sectionTypes';

export const PASSWORD_SECTION = 'password';

export const PASSWORD: SettingsSection = {
  id: PASSWORD_SECTION,
  title: 'Password policy',
  description: 'What a password must satisfy when somebody sets or changes one.',
  fields: [
    {
      name: 'password_min_length',
      group: 'Length and complexity',
      label: 'Minimum length',
      control: 'count',
      unit: 'characters',
    },
    {
      name: 'password_require_digit',
      group: 'Length and complexity',
      label: 'Require a digit',
      control: 'toggle',
    },
    {
      name: 'password_require_uppercase',
      group: 'Length and complexity',
      label: 'Require an uppercase letter',
      control: 'toggle',
    },
    {
      name: 'password_require_lowercase',
      group: 'Length and complexity',
      label: 'Require a lowercase letter',
      control: 'toggle',
    },
    {
      name: 'password_require_special',
      group: 'Length and complexity',
      label: 'Require a special character',
      control: 'toggle',
    },
    {
      name: 'password_not_username',
      group: 'Must not contain',
      label: 'Refuse the username',
      control: 'toggle',
    },
    {
      name: 'password_not_email',
      group: 'Must not contain',
      label: 'Refuse the email address',
      control: 'toggle',
    },
    {
      name: 'password_history_depth',
      group: 'Reuse and age',
      label: 'Passwords remembered',
      control: 'count',
      unit: 'passwords',
      description: 'A new password may not repeat one of this many before it. 0 remembers none.',
    },
    {
      name: 'password_max_age_days',
      group: 'Reuse and age',
      label: 'Password lifetime',
      control: 'count',
      unit: 'days',
      description: 'A password older than this has to be changed. 0 never expires one.',
    },
    {
      name: 'breached_check',
      group: 'Breached passwords',
      label: 'Check against known breaches',
      control: 'choice',
      description:
        'A new password that passed the rules above is refused if it is known from breaches.',
      more: 'The dataset is the hash list an operator loaded into the server, and nothing leaves it. Remote asks a range service for the first five characters of the SHA-1 hash and nothing else. Off skips the check, and the audit trail records that.',
      options: [
        { id: 'off', label: 'Off' },
        { id: 'dataset', label: 'Dataset loaded on the server' },
        { id: 'remote', label: 'Remote range lookup' },
      ],
    },
    {
      name: 'breached_on_error',
      group: 'Breached passwords',
      label: 'When a remote lookup fails',
      control: 'choice',
      description: 'When the lookup times out, is refused or is too busy.',
      dependsOn: {
        on: 'breached_check',
        value: 'remote',
        otherwise: 'Applies to the remote lookup only.',
      },
      options: [
        { id: 'open', label: 'Accept the password' },
        { id: 'closed', label: 'Refuse it and ask to try again' },
      ],
    },
  ],
};
