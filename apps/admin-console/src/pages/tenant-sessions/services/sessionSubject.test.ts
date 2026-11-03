import { describe, expect, it } from 'vitest';
import { subjectLinkOf, subjectCell } from '#/pages/tenant-sessions/services/sessionSubject';

describe('the subject of a session', () => {
  it('is shown by the label it was given, with its id kept for the link and the detail', () => {
    expect(subjectCell({ subjectId: 's1' }, 'ada')).toEqual({ label: 'ada', id: 's1' });
  });
});

describe('the link to a subject', () => {
  const href = (tenant: string, id: string) => `/console/${tenant}/subjects/${id}`;

  it('is made for a caller who may read subjects, and is none for one who may not', () => {
    expect(subjectLinkOf(true, 'acme', href)?.('s1')).toBe('/console/acme/subjects/s1');
    expect(subjectLinkOf(false, 'acme', href)).toBeNull();
  });
});
