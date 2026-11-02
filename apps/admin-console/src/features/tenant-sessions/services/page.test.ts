import { describe, expect, it } from 'vitest';
import {
  endConsequence,
  endedText,
  endFailure,
  endMoreText,
  subjectLinkOf,
  subjectCell,
} from '#/features/tenant-sessions/services/page';
import type { GatewayFailure } from '#/shared/services/result';

const refused = (status: number, extra: object = {}): GatewayFailure => ({
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank', title: 'Title', status, ...extra },
});

describe('the subject of a session', () => {
  it('is named by its username, with its id kept for the link and the detail', () => {
    expect(subjectCell({ subject_id: 's1', username: 'ada' })).toEqual({
      label: 'ada',
      id: 's1',
    });
  });

  it('falls back to the id for a subject that has no username', () => {
    expect(subjectCell({ subject_id: 's1', username: null })).toEqual({
      label: 's1',
      id: 's1',
    });
  });
});

describe('the link to a subject', () => {
  const href = (tenant: string, id: string) => `/console/${tenant}/subjects/${id}`;

  it('is made for a caller who may read subjects, and is none for one who may not', () => {
    expect(subjectLinkOf(true, 'acme', href)?.('s1')).toBe('/console/acme/subjects/s1');
    expect(subjectLinkOf(false, 'acme', href)).toBeNull();
  });
});

describe('what ending every session says it does', () => {
  it('names the tenant, who is signed out, the grants, the back-channel tokens and the limit', () => {
    const text = endConsequence('acme', false);
    expect(text).toContain('Every live session in acme ends, whoever holds it');
    expect(text).toContain('offline_access');
    expect(text).toContain('back-channel logout');
    expect(text).toContain('admin capability you do not hold');
    expect(text).toContain('500');
    expect(text).not.toContain('your own console session');
  });

  it("says the operator's own console session ends too when it belongs to the tenant", () => {
    expect(endConsequence('acme', true)).toContain(
      'Your own console session is one of them: the console signs you out at its next request.',
    );
  });
});

describe('what ending every session came to', () => {
  const ended = (n: number, remaining = 0, beyond = 0) =>
    endedText('acme', { ended: n, remaining, beyond_ceiling: beyond });

  it('counts what ended', () => {
    expect(ended(1)).toBe('1 session in acme ended.');
    expect(ended(3)).toBe('3 sessions in acme ended.');
    expect(ended(0)).toBe('0 sessions in acme ended.');
  });

  it('says to end again while more are live within reach', () => {
    expect(ended(500, 12)).toBe(
      '500 sessions in acme ended. More are still live: end every session again to end the next 500.',
    );
  });

  it('says how many were left alone for a capability the caller lacks', () => {
    expect(ended(2, 0, 1)).toBe(
      '2 sessions in acme ended. 1 was left alone: its subject holds an admin capability you do not hold.',
    );
    expect(ended(2, 0, 3)).toContain(
      '3 were left alone: their subjects hold an admin capability you do not hold.',
    );
  });
});

describe('when ending every session fails', () => {
  it('words a refusal, a lost answer and a console fault', () => {
    expect(endFailure('acme', refused(403))).toContain('manage-sessions');
    expect(endFailure('acme', { ok: false, kind: 'schema' })).toContain('may have been done');
    expect(endFailure('acme', { ok: false, kind: 'network' })).toContain('has not been sent again');
    expect(endFailure('acme', { ok: false, kind: 'defect' })).toContain('was not done');
  });
});

describe('what stays beside the action while sessions remain', () => {
  it('says to end again only while more are live, and is none otherwise', () => {
    expect(endMoreText('acme', { ended: 500, remaining: 12, beyond_ceiling: 0 })).toBe(
      'More sessions are still live in acme: end every session again to end the next 500.',
    );
    expect(endMoreText('acme', { ended: 3, remaining: 0, beyond_ceiling: 1 })).toBeNull();
  });
});
