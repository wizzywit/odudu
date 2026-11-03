import { describe, expect, it } from 'vitest';
import { subjectLinkOf, subjectCell } from '#/features/tenant-sessions/services/sessionSubject';

describe('the subject of a session', () => {
  it('is named by its username, with its id kept for the link and the detail', () => {
    expect(subjectCell({ subjectId: 's1', username: 'ada' })).toEqual({
      label: 'ada',
      id: 's1',
    });
  });

  it('falls back to the id for a subject that has no username', () => {
    expect(subjectCell({ subjectId: 's1', username: null })).toEqual({
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
