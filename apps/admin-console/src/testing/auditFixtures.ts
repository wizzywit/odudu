import type { AuditEvent } from '#/entities/audit-event';
import { json, type Answer } from '#/testing/fakeTransport';
import { graceRoutes } from '#/testing/renderConsole';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import { EVERY_TENANT_CAPABILITY } from '#/testing/roleAnswers';

export function auditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'a1',
    occurred_at: '2026-09-28T13:41:05Z',
    event_type: 'admin_mutation',
    action: 'client.update',
    outcome: 'allowed',
    actor_tenant_id: 't1',
    actor_subject_id: '0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e',
    actor_client_id: null,
    actor_name: null,
    actor_origin: 'tenant',
    resource_type: 'client',
    resource_id: 'c1',
    request_id: 'req-7f3a9c',
    ip: '203.0.113.9',
    detail: {},
    ...overrides,
  };
}

export const AUDIT = `${ACME_ADMIN}/audit`;

export const GRACE_ID = '0192f7a4-5c1e-7b3a-9d2e-6f8a1b2c3d4e';
export const CLIENT_ID = '0192f7a4-0000-7b3a-9d2e-6f8a1b2c3d4e';

// Three rows, newest first: two of one request, one written by a system administrator.
export const TRAIL: readonly AuditEvent[] = [
  auditEvent({
    id: 'e3',
    occurred_at: '2026-10-12T09:03:00Z',
    action: 'client.update',
    request_id: 'req-aaaaaa',
    actor_subject_id: GRACE_ID,
    actor_name: 'grace',
    resource_type: 'client',
    resource_id: CLIENT_ID,
    detail: { enabled: { before: true, after: false } },
  }),
  auditEvent({
    id: 'e2',
    occurred_at: '2026-10-12T09:02:00Z',
    action: 'client.rotate_secret',
    outcome: 'refused',
    request_id: 'req-aaaaaa',
    actor_subject_id: GRACE_ID,
    actor_name: 'grace',
    resource_type: 'client',
    resource_id: CLIENT_ID,
    detail: { denied: ['manage-clients'] },
  }),
  auditEvent({
    id: 'e1',
    occurred_at: '2026-10-12T09:01:00Z',
    action: 'tenant.amend_settings',
    request_id: 'req-bbbbbb',
    actor_tenant_id: 'system-tenant',
    actor_subject_id: '0192f7a4-9999-7b3a-9d2e-6f8a1b2c3d4e',
    actor_name: null,
    actor_origin: 'system',
    resource_type: 'tenant',
    resource_id: 'acme-id',
  }),
];

// grace of acme holding the capabilities given, with the trail above.
export function auditRoutes(
  capabilities: readonly string[] = EVERY_TENANT_CAPABILITY,
  extra: Record<string, Answer> = {},
): Record<string, Answer> {
  return graceRoutes(capabilities, { [`GET ${AUDIT}`]: json({ items: TRAIL }) }, extra);
}
