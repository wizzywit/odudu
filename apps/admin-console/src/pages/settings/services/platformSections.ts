import { SETTINGS_WORDS } from '#/pages/settings/services/settingsPageWords';
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
    title: SETTINGS_WORDS.registrationTitle,
    description: SETTINGS_WORDS.registrationDescription,
    fields: [
      {
        name: 'client_registration_policy',
        label: SETTINGS_WORDS.policyLabel,
        control: 'choice',
        options: [
          { id: 'disabled', label: 'Closed: only an administrator creates clients' },
          { id: 'token', label: 'With a registration token' },
          { id: 'open', label: 'Open: any application may register' },
          { id: 'mcp', label: SETTINGS_WORDS.mcpOption },
        ],
      },
      {
        name: 'cimd_enabled',
        label: SETTINGS_WORDS.cimdLabel,
        control: 'toggle',
        description: SETTINGS_WORDS.cimdDescription,
      },
      {
        name: 'max_clients',
        label: 'Most clients',
        control: 'count',
        unit: 'clients',
        description:
          'The most clients an administrator or a registration token can make. Clients that register themselves have limits of their own.',
      },
    ],
  },
  {
    id: 'agents',
    title: 'Agents',
    description:
      'The limits on agent instances and on what an agent may write under a person’s grant.',
    fields: [
      {
        name: 'agent_max_delegation_depth',
        label: 'Delegation depth',
        control: 'count',
        unit: 'levels',
        group: 'Instances',
        description: 'How many instances deep one delegation may go.',
      },
      {
        name: 'agent_max_children',
        label: 'Children per instance',
        control: 'count',
        unit: 'instances',
        group: 'Instances',
        description: 'How many live child instances one instance may have.',
      },
      {
        name: 'agent_max_live_instances',
        label: 'Live instances',
        control: 'count',
        unit: 'instances',
        group: 'Instances',
        description: 'How many instances the tenant may hold at once.',
      },
      {
        name: 'agent_instance_ttl_seconds',
        label: 'Instance lifetime',
        control: 'seconds',
        group: 'Instances',
        description:
          'An instance ends this long after it is made, never after its owner’s session.',
      },
      {
        name: 'agent_instance_idle_seconds',
        label: 'Instance idle timeout',
        control: 'seconds',
        group: 'Instances',
        description:
          'An instance ends after this long without a call, never after its owner’s session.',
      },
      {
        name: 'agent_approval_ttl_seconds',
        label: 'Approval lifetime',
        control: 'seconds',
        group: 'Approvals',
        description: 'A person has this long to approve one action an agent asked to take.',
      },
      {
        name: 'agent_writes_per_grant',
        label: 'Writes per grant',
        control: 'count',
        unit: 'writes',
        group: 'Writes',
        description: 'How many writes an agent may make under one grant, creates included.',
      },
      {
        name: 'agent_creates_per_grant',
        label: 'Creates per grant',
        control: 'count',
        unit: 'creates',
        group: 'Writes',
        description: 'How many of those writes under one grant may create something.',
      },
      {
        name: 'agent_window_writes',
        label: 'Writes per day',
        control: 'count',
        unit: 'writes',
        group: 'Writes',
        description:
          'How many writes one agent type may make for one person in a 24-hour UTC window, across their sign-ins.',
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
