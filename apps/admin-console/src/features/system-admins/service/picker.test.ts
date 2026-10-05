import { describe, expect, it } from 'vitest';
import {
  choosable,
  pickerUnavailable,
  subjectName,
  type Subject,
} from '#/features/system-admins/service/picker.ts';

const subject = (id: string): Subject => ({ id, username: id }) as Subject;

describe('a subject of system', () => {
  it('is named by username, or by id when it has none', () => {
    expect(subjectName({ id: 's1', username: 'ada' })).toBe('ada');
    expect(subjectName({ id: 's2', username: null })).toBe('s2');
  });
});

describe('the picker of subjects', () => {
  const holders = new Set(['s1']);

  it('marks a subject that already holds a capability, once the holders are known', () => {
    expect(pickerUnavailable(holders, subject('s1'))).toBe(
      'already holds a capability: change it in the list',
    );
    expect(pickerUnavailable(holders, subject('s2'))).toBeNull();
    expect(pickerUnavailable(null, subject('s1'))).toBeNull();
  });

  it('chooses an offered subject that does not already hold one', () => {
    const options = [subject('s1'), subject('s2')];
    expect(choosable('s2', holders, options)).toBe(options[1]);
    expect(choosable('s1', holders, options)).toBeNull();
    expect(choosable('s1', null, options)).toBe(options[0]);
    expect(choosable('s9', holders, options)).toBeNull();
    expect(choosable(null, holders, options)).toBeNull();
  });
});
