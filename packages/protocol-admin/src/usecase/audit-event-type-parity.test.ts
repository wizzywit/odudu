import { listAuditQuerySchema } from '@odudu/contracts/admin';
import { AUDIT_EVENT_TYPES } from '@odudu/domain-audit';
import { coerceTenantSetting } from '@odudu/domain-tenant';
import { describe, expect, it } from 'vitest';

describe('the wire event_type enum matches @odudu/domain-audit’s vocabulary', () => {
  it('accepts exactly the event types @odudu/domain-audit records', () => {
    const wireValues = listAuditQuerySchema.shape.event_type.unwrap().options;

    expect([...wireValues].sort()).toEqual([...AUDIT_EVENT_TYPES].sort());
  });
});

describe('the audit_event_types setting names @odudu/domain-audit’s vocabulary', () => {
  it('admits exactly the event types the writer records, in their order', () => {
    const outcome = coerceTenantSetting('audit_event_types', [...AUDIT_EVENT_TYPES].reverse());
    expect(outcome).toMatchObject({ kind: 'coerced', value: [...AUDIT_EVENT_TYPES] });
  });
});
