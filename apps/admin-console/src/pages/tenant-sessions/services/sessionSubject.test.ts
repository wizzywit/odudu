import { describe, expect, it } from 'vitest';
import { subjectCell } from '#/pages/tenant-sessions/services/sessionSubject';

describe('the subject of a session', () => {
  it('is shown by the label it was given, with its id kept for the link and the detail', () => {
    expect(subjectCell({ subjectId: 's1' }, 'ada')).toEqual({ label: 'ada', id: 's1' });
  });
});
