import type { AuditEvent } from '@odudu/contracts/admin';
import type { Conflict } from '#/shared/service/conflict.ts';
import type { KeyValuePair } from '#/shared/view/Field.tsx';

export const TENANT = 'acme';

export const NOW = new Date('2026-09-28T14:03:22Z');

export interface ClientRow {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  readonly type: 'confidential' | 'public';
  readonly enabled: boolean;
  readonly created: string;
}

export const CLIENTS: readonly ClientRow[] = [
  {
    id: '0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e',
    clientId: 'billing-portal',
    name: 'Billing portal',
    type: 'confidential',
    enabled: true,
    created: '2026-09-28T13:41:05Z',
  },
  {
    id: '0192f7a4-81d0-7c44-a1f3-2b9e0c7d5a61',
    clientId: 'acme-mobile',
    name: 'Acme mobile app',
    type: 'public',
    enabled: true,
    created: '2026-09-21T08:12:44Z',
  },
  {
    id: '0192f7a5-0a3b-7e19-b6c2-9f4d8e1a2b73',
    clientId: 'warehouse-scanner',
    name: 'Warehouse scanner (legacy)',
    type: 'public',
    enabled: false,
    created: '2026-06-02T17:30:00Z',
  },
  {
    id: '0192f7a5-3c77-7a02-8e5d-1c6b4f9a0e88',
    clientId: 'reporting-batch',
    name: 'Nightly reporting',
    type: 'confidential',
    enabled: true,
    created: '2026-03-14T02:00:19Z',
  },
];

export const REDIRECT_URIS: readonly string[] = [
  'https://billing.acme.example/callback',
  'http://billing.acme.example/callback',
  'https://billing-staging.acme.example/callback',
];

export const CLAIM_VALUES: readonly KeyValuePair[] = [
  { key: 'tier', value: 'enterprise' },
  { key: 'region', value: 'eu-west' },
];

export const STEP_REQUIREMENTS = [
  { id: 'required', label: 'Required' },
  { id: 'alternative', label: 'Alternative' },
  { id: 'conditional', label: 'Conditional' },
  { id: 'disabled', label: 'Disabled' },
];

export const SUBJECT_FIELDS = [
  { id: 'username', label: 'username' },
  { id: 'email', label: 'email' },
];

export const CLIENT_FIELDS = [
  { id: 'name', label: 'name' },
  { id: 'client_id', label: 'client id' },
];

export const CLIENT_SECRET = 'q7Hn2vX0pR-4tKe9WmZ3cY8bLs1uD6fA';

export const RAIL_GROUPS = [
  { items: [{ href: '#overview', label: 'Overview' }] },
  {
    heading: 'Identity',
    items: [
      { href: '#subjects', label: 'Subjects' },
      { href: '#groups', label: 'Groups' },
      { href: '#roles', label: 'Roles' },
    ],
  },
  {
    heading: 'Applications',
    items: [
      { href: '#editing', label: 'Clients' },
      { href: '#scopes', label: 'Scopes' },
      { href: '#tokens', label: 'Registration tokens' },
    ],
  },
  {
    heading: 'Security',
    items: [
      { href: '#flow', label: 'Sign-in flow' },
      { href: '#keys', label: 'Signing keys' },
    ],
  },
  {
    heading: 'Tenant',
    items: [
      { href: '#settings', label: 'Settings' },
      { href: '#email', label: 'Email' },
      { href: '#import', label: 'Import / export' },
    ],
  },
  { heading: 'Observe', items: [{ href: '#audit', label: 'Audit trail' }] },
];

export const CONFLICTS: readonly Conflict[] = [
  {
    field: 'access_token_ttl',
    label: 'Access token lifetime',
    theirs: 900,
    yours: 600,
    secret: false,
  },
];

const EVENT: AuditEvent = {
  id: 'a1',
  occurred_at: '2026-09-28T13:41:05Z',
  event_type: 'admin_mutation',
  action: 'client.update',
  outcome: 'allowed',
  actor_tenant_id: 't1',
  actor_subject_id: '0192f7a4-9e21-7d40-8c3b-5a6f1e2d3c4b',
  actor_client_id: null,
  resource_type: 'client',
  resource_id: '0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e',
  request_id: '7f3a9c1e-2b4d-4e6f-8a0b-1c2d3e4f5a6b',
  ip: '203.0.113.9',
  detail: {},
};

export const EVENTS: readonly AuditEvent[] = [
  EVENT,
  { ...EVENT, id: 'a2', occurred_at: '2026-09-28T12:02:40Z', outcome: 'refused' },
  {
    ...EVENT,
    id: 'a3',
    occurred_at: '2026-09-21T08:12:44Z',
    action: 'client.create',
    request_id: null,
  },
];
