import { describe, expect, it } from 'vitest';
import { subjectIsEnabled } from '#/service/subject-enabled';

describe('subjectIsEnabled', () => {
  it('is true only for a subject that exists and was never disabled', () => {
    expect(subjectIsEnabled({ disabledAt: null })).toBe(true);
    expect(subjectIsEnabled({ disabledAt: new Date() })).toBe(false);
    expect(subjectIsEnabled(null)).toBe(false);
  });
});
