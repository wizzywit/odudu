import { describe, expect, it } from 'vitest';
import { subjectName, usernameOrId } from '#/entities/subject/services/subjectName';

describe('the username', () => {
  it('names a subject by its username, or by its kind and id when it has none', () => {
    expect(subjectName({ id: 's1', type: 'user', username: 'ada' })).toBe('ada');
    expect(subjectName({ id: 's2', type: 'service', username: null })).toBe('service s2');
  });

  it('names by username, or by id alone when there is none', () => {
    expect(usernameOrId({ id: 's1', username: 'ada' })).toBe('ada');
    expect(usernameOrId({ id: 's2', username: null })).toBe('s2');
  });
});
