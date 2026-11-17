import { REGISTRATION_USERNAME_CHOICES } from '@odudu/contracts/admin';
import { PASSWORD } from '#/pages/settings/services/passwordSection';
import { PROFILE } from '#/pages/settings/services/profileSection';
import {
  AUTHENTICATORS,
  PASSKEY_REQUIREMENT,
} from '#/pages/settings/services/authenticatorsSection';
import type { SettingsSection } from '#/pages/settings/services/sectionTypes';

export { PASSWORD_SECTION } from '#/pages/settings/services/passwordSection';

const USERNAME_MODE_WORDS: Readonly<
  Record<(typeof REGISTRATION_USERNAME_CHOICES)[number], string>
> = { required: 'Required', optional: 'Optional', generated: 'Generated' };

const USERNAME_MODE_DESCRIPTION =
  'Whether the registration form asks for a username. Optional and Generated need both “Sign in with a verified email address” and “Verify email addresses” on, and keep them on; Generated asks for no username at all and assigns one. The server refuses the change otherwise.';

export const GENERAL_SECTION = 'general';
export const LOCKOUT_SECTION = 'brute-force';
export const TERMS_SECTION = 'terms';

export const ACCESS_SECTIONS: readonly SettingsSection[] = [
  {
    id: GENERAL_SECTION,
    title: 'General',
    description: "What this tenant's own pages call it, and whether it is in service.",
    fields: [
      {
        name: 'display_name',
        label: 'Display name',
        control: 'text',
        description: 'Leave it empty to use the tenant name.',
      },
      {
        name: 'enabled',
        label: 'Enabled',
        control: 'toggle',
        description:
          'Off stops every sign-in in this tenant. Saving it off asks you to type the tenant name first.',
      },
    ],
  },
  {
    id: 'sessions',
    title: 'Sessions',
    description: 'How long a sign-in lasts, and how long a person has to finish one.',
    fields: [
      {
        name: 'sso_session_idle_seconds',
        label: 'Idle timeout',
        control: 'seconds',
        description: 'A session ends after this long without activity. At most the maximum.',
      },
      {
        name: 'sso_session_max_seconds',
        label: 'Maximum lifetime',
        control: 'seconds',
        description: 'A session ends this long after sign-in, however active it has been.',
      },
      {
        name: 'max_sessions_per_browser',
        label: 'Sessions per browser',
        control: 'count',
        unit: 'sessions',
        description: 'How many sessions one browser may hold at once.',
      },
      {
        name: 'login_ttl_seconds',
        label: 'Time to finish a sign-in',
        control: 'seconds',
        description: 'A sign-in left unfinished this long has to be started again.',
      },
      {
        name: 'session_freshness_seconds',
        label: 'Recent sign-in window',
        control: 'seconds',
        description: 'How recently a person must have signed in to change something sensitive.',
        more: 'A person must have signed in this recently to change their address or username, end all their other sessions, withdraw a consent or remove an authenticator.',
      },
    ],
  },
  {
    id: 'remember-me',
    title: 'Remember me',
    description: 'A longer session for a person who asks to stay signed in.',
    fields: [
      {
        name: 'remember_me_allowed',
        label: 'Offer remember me',
        control: 'toggle',
        description: 'The sign-in page shows the choice only while this is on.',
      },
      {
        name: 'remember_me_idle_seconds',
        label: 'Idle timeout',
        control: 'seconds',
        description: 'Without activity this long, a remembered session ends. At most the maximum.',
      },
      {
        name: 'remember_me_max_seconds',
        label: 'Maximum lifetime',
        control: 'seconds',
        description: 'A remembered session ends this long after sign-in.',
      },
    ],
  },
  {
    id: 'registration',
    title: 'Registration and recovery',
    description: 'Whether people can create an account and get back into one themselves.',
    fields: [
      {
        name: 'registration_allowed',
        label: 'Self-registration',
        control: 'toggle',
        description: 'Anybody may create an account on the sign-in page.',
      },
      {
        name: 'verify_email',
        label: 'Verify email addresses',
        control: 'toggle',
        description: 'The account is created when the person confirms their address from a mail.',
      },
      {
        name: 'verify_email_ttl_seconds',
        label: 'Verification link lifetime',
        control: 'seconds',
        description: 'A verification link stops working after this long.',
      },
      {
        name: 'registration_username',
        label: 'Username at registration',
        control: 'choice',
        description: USERNAME_MODE_DESCRIPTION,
        options: REGISTRATION_USERNAME_CHOICES.map((id) => ({
          id,
          label: USERNAME_MODE_WORDS[id],
        })),
      },
      {
        name: 'reset_password_allowed',
        label: 'Password reset by mail',
        control: 'toggle',
        description: 'A person who forgot their password may ask for a reset link.',
      },
      {
        name: 'reset_password_ttl_seconds',
        label: 'Reset link lifetime',
        control: 'seconds',
        description: 'A reset link stops working after this long.',
      },
    ],
  },
  {
    id: TERMS_SECTION,
    title: 'Terms',
    description:
      'The terms a person accepts when asked to. Setting them asks nobody: an administrator asks a person from the Required actions tab of their record, and again when the terms change.',
    fields: [
      {
        name: 'terms_uri',
        label: 'Terms address',
        control: 'url',
        description:
          'An https address, or http to this machine, with no fragment. Leave it empty for no terms.',
      },
      {
        name: 'terms_version',
        label: 'Terms version',
        control: 'text',
        short: true,
        description:
          'Up to 64 characters. A person accepts one version. Changing it asks nobody again by itself.',
      },
    ],
  },
  PROFILE,
  AUTHENTICATORS,
  PASSKEY_REQUIREMENT,
  {
    id: 'usernames',
    title: 'Usernames',
    description: 'How a person is named, and what they type to sign in.',
    fields: [
      {
        name: 'username_editable',
        label: 'Usernames can be renamed',
        control: 'toggle',
        description: 'An administrator may change a subject’s username.',
      },
      {
        name: 'login_with_email',
        label: 'Sign in with a verified email address',
        control: 'toggle',
        description: 'The sign-in form takes a verified email address in place of a username.',
      },
    ],
  },
  PASSWORD,
  {
    id: LOCKOUT_SECTION,
    title: 'Brute force',
    description:
      'When repeated wrong passwords or wrong second-factor codes lock an account, and for how long.',
    fields: [
      {
        name: 'brute_force_max_failures',
        label: 'Failures before a lockout',
        control: 'count',
        unit: 'failures',
      },
      {
        name: 'brute_force_lockout_seconds',
        label: 'First lockout',
        control: 'seconds',
        description: 'How long the first lockout lasts. At most the longest lockout.',
      },
      {
        name: 'brute_force_max_lockout_seconds',
        label: 'Longest lockout',
        control: 'seconds',
        description: 'Lockouts grow with each repeat, up to this.',
      },
      {
        name: 'brute_force_failure_reset_seconds',
        label: 'Failures forgotten after',
        control: 'seconds',
        description: 'Failures this old stop counting toward a lockout.',
      },
    ],
  },
];
