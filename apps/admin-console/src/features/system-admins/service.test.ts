import { describe, expect, it } from 'vitest';
import { subjectName } from '#/features/system-admins/service.ts';

describe('a subject of system', () => {
  it('is named by username, or by id when it has none', () => {
    expect(subjectName({ id: 's1', username: 'ada' })).toBe('ada');
    expect(subjectName({ id: 's2', username: null })).toBe('s2');
  });
});
