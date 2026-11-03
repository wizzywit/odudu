import type { SettingsSection } from '#/pages/settings/services/sectionTypes';

export const PLATFORM_SECTIONS: readonly SettingsSection[] = [
  {
    id: 'tokens',
    title: 'Token lifetimes',
    description: 'What a client gets unless it carries lifetimes of its own.',
    fields: [
      { name: 'access_token_ttl_seconds', label: 'Access token', control: 'seconds' },
      { name: 'id_token_ttl_seconds', label: 'ID token', control: 'seconds' },
      { name: 'refresh_token_ttl_seconds', label: 'Refresh token', control: 'seconds' },
      {
        name: 'authorization_code_ttl_seconds',
        label: 'Authorization code',
        control: 'seconds',
        description: 'A client has this long to trade a code for tokens.',
      },
    ],
  },
  {
    id: 'client-registration',
    title: 'Dynamic client registration',
    description: 'Whether applications may register themselves as clients of this tenant.',
    fields: [
      {
        name: 'client_registration_policy',
        label: 'Policy',
        control: 'choice',
        options: [
          { id: 'disabled', label: 'Closed: only an administrator creates clients' },
          { id: 'token', label: 'With a registration token' },
          { id: 'open', label: 'Open: any application may register' },
        ],
      },
      {
        name: 'max_clients',
        label: 'Most clients',
        control: 'count',
        unit: 'clients',
        description:
          'A tenant with this many clients refuses to make more, however they are created.',
      },
    ],
  },
  {
    id: 'retention',
    title: 'Audit retention',
    description: 'How long the audit trail is kept, and which events it records.',
    fields: [
      {
        name: 'audit_retention_days',
        label: 'Keep events for',
        control: 'count',
        unit: 'days',
      },
      {
        name: 'audit_event_types',
        label: 'Events recorded',
        control: 'set',
        options: [
          {
            id: 'admin_mutation',
            label: 'Changes by administrators',
            fixed: 'Always recorded.',
          },
          {
            id: 'admin_access',
            label: 'Reads by administrators',
            fixed: 'Always recorded.',
          },
          { id: 'authentication', label: 'Sign-ins and refused sign-ins' },
          { id: 'session', label: 'Sessions starting and ending' },
          { id: 'token', label: 'Tokens issued and revoked' },
          { id: 'credential', label: 'Passwords, keys and codes set or changed' },
        ],
      },
    ],
  },
];
