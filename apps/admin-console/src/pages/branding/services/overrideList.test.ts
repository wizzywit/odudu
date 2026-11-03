import { describe, expect, it } from 'vitest';
import { capText, PAGE_SIZE } from '#/pages/branding/services/overrideList';

describe('the count above the table', () => {
  it('is read fifty overrides at a time', () => {
    expect(PAGE_SIZE).toBe(50);
  });

  it('is a total only once nothing is left to load', () => {
    expect(capText(1, false)).toContain('1 override in this language');
    expect(capText(50, true)).toContain('50 overrides loaded so far; more follow');
    expect(capText(50, true)).not.toContain('in this language');
  });
});
