import { describe, expect, it } from 'vitest';
import { subjectName } from '#/features/subjects/services/subjectName';

describe('the username', () => {
  it('names a subject by its username, or by its kind and id when it has none', () => {
    expect(subjectName({ id: 's1', type: 'user', username: 'ada' })).toBe('ada');
    expect(subjectName({ id: 's2', type: 'service', username: null })).toBe('service s2');
  });
});
