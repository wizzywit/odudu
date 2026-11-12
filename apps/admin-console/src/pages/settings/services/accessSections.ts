import type { SettingsSection } from '#/pages/settings/services/sectionTypes';

export const GENERAL_SECTION = 'general';
export const LOCKOUT_SECTION = 'brute-force';
export const PASSWORD_SECTION = 'password';
export const AUTHENTICATORS_SECTION = 'authenticators';

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
      { name: 'enabled', label: 'Enabled', control: 'toggle' },
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
        description:
          'A person must have signed in this recently to change their address or username, end all their other sessions, withdraw a consent or remove an authenticator.',
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
    id: AUTHENTICATORS_SECTION,
    title: 'Authenticators',
    description:
      'What a new authenticator app, passkey or recovery set is made with. One already enrolled keeps the values it was made with.',
    fields: [
      {
        name: 'totp_algorithm',
        label: 'Authenticator app algorithm',
        control: 'choice',
        description:
          'SHA1 works in every authenticator app. A person’s app must support another algorithm, digit count and period before they can use it; the enrolment page says so.',
        options: [
          { id: 'SHA1', label: 'SHA1' },
          { id: 'SHA256', label: 'SHA256' },
          { id: 'SHA512', label: 'SHA512' },
        ],
      },
      {
        name: 'totp_digits',
        label: 'Authenticator app code length',
        control: 'choice',
        numeric: true,
        options: [
          { id: '6', label: '6 digits' },
          { id: '8', label: '8 digits' },
        ],
      },
      {
        name: 'totp_period',
        label: 'Authenticator app code period',
        control: 'choice',
        numeric: true,
        options: [
          { id: '30', label: '30 seconds' },
          { id: '60', label: '60 seconds' },
        ],
      },
      {
        name: 'webauthn_user_verification',
        label: 'Passkey user verification',
        control: 'choice',
        description:
          'Whether a new passkey checks the person with a PIN or biometric. A passkey made without it signs in as one factor, so a second factor is still asked for.',
        options: [
          { id: 'required', label: 'Required' },
          { id: 'preferred', label: 'Preferred' },
          { id: 'discouraged', label: 'Discouraged' },
        ],
      },
      {
        name: 'webauthn_resident_key',
        label: 'Passkey stored on the device',
        control: 'choice',
        description:
          'A passkey that is not stored on the device cannot sign a person in who has not typed a username.',
        options: [
          { id: 'required', label: 'Required' },
          { id: 'preferred', label: 'Preferred' },
          { id: 'discouraged', label: 'Discouraged' },
        ],
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
  },
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
  {
    id: PASSWORD_SECTION,
    title: 'Password policy',
    description: 'What a password must satisfy when somebody sets or changes one.',
    fields: [
      {
        name: 'password_min_length',
        label: 'Minimum length',
        control: 'count',
        unit: 'characters',
      },
      { name: 'password_require_digit', label: 'Require a digit', control: 'toggle' },
      {
        name: 'password_require_uppercase',
        label: 'Require an uppercase letter',
        control: 'toggle',
      },
      {
        name: 'password_require_lowercase',
        label: 'Require a lowercase letter',
        control: 'toggle',
      },
      { name: 'password_require_special', label: 'Require a special character', control: 'toggle' },
      { name: 'password_not_username', label: 'Refuse the username', control: 'toggle' },
      { name: 'password_not_email', label: 'Refuse the email address', control: 'toggle' },
      {
        name: 'password_history_depth',
        label: 'Passwords remembered',
        control: 'count',
        unit: 'passwords',
        description: 'A new password may not repeat one of this many before it. 0 remembers none.',
      },
      {
        name: 'password_max_age_days',
        label: 'Password lifetime',
        control: 'count',
        unit: 'days',
        description: 'A password older than this has to be changed. 0 never expires one.',
      },
    ],
  },
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
