import { describe, expect, it } from 'vitest';
import {
  correlationTags,
  requestLabel,
  requestNoteOf,
  requestRowCounts,
} from '#/entities/audit-event/services/requestCorrelation';
import { auditEvent } from '#/testing/auditFixtures';

describe('request labels', () => {
  it('is short and the same every time for the same id', () => {
    expect(requestLabel('01a0ee8c-69b5-7e9b-a23c-621c22a3eb69')).toBe('request a3eb69');
    expect(requestLabel('req-7f3a9c')).toBe(requestLabel('req-7f3a9c'));
  });

  it('counts only the ids that more than one loaded row shares', () => {
    const rows = [
      auditEvent({ id: '1', request_id: 'r1' }),
      auditEvent({ id: '2', request_id: 'r1' }),
      auditEvent({ id: '3', request_id: 'r2' }),
      auditEvent({ id: '4', request_id: null }),
      auditEvent({ id: '5', request_id: null }),
    ];
    expect([...requestRowCounts(rows)]).toEqual([['r1', 2]]);
  });

  it('tags each shared id with its label and how many rows share it', () => {
    const rows = [
      auditEvent({ id: '1', request_id: 'req-aaaaaa' }),
      auditEvent({ id: '2', request_id: 'req-aaaaaa' }),
      auditEvent({ id: '3', request_id: 'req-bbbbbb' }),
    ];
    expect([...correlationTags(rows)]).toEqual([['req-aaaaaa', 'request aaaaaa · 2 rows loaded']]);
  });

  it("says what the label is worth beside one row's request id", () => {
    expect(requestNoteOf('req-7f3a9c')).toBe(
      'Label request 7f3a9c. The caller can set it, so it is a correlation, not evidence.',
    );
    expect(requestNoteOf(null)).toBeNull();
  });
});
