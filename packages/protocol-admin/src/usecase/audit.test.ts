import { listAuditQuerySchema } from '@odudu/contracts/admin';
import { AUDIT_EVENT_TYPES } from '@odudu/domain-audit';
import { describe, expect, it } from 'vitest';

describe('listAuditQuerySchema', () => {
  it('accepts exactly the event types @odudu/domain-audit records', () => {
    const wireValues = listAuditQuerySchema.shape.event_type.unwrap().options;

    expect([...wireValues].sort()).toEqual([...AUDIT_EVENT_TYPES].sort());
  });
});
