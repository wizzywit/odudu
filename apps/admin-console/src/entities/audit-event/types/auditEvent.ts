export type AuditOutcome = 'allowed' | 'refused' | 'failed';
export type ActorOrigin = 'tenant' | 'system' | 'other-tenant';

// One row of the audit trail as the server writes it. The wire's field names
// are kept: the rules read them as they come.
export interface AuditEvent {
  id: string;
  occurred_at: string;
  event_type: string;
  action: string;
  outcome: AuditOutcome;
  actor_tenant_id: string | null;
  actor_subject_id: string | null;
  actor_client_id: string | null;
  actor_name: string | null;
  actor_origin: ActorOrigin | null;
  resource_type: string | null;
  resource_id: string | null;
  request_id: string | null;
  ip: string | null;
  detail: Record<string, unknown>;
}

export interface AuditPage {
  items: AuditEvent[];
  next?: string | undefined;
}
