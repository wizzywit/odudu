import { describe, expect, it } from 'vitest';
import { disablesTenant } from '#/features/settings/services/general';

describe('disablesTenant', () => {
  it('is true only when an enabled tenant is being switched off', () => {
    expect(disablesTenant(true, false)).toBe(true);
    expect(disablesTenant(false, false)).toBe(false);
    expect(disablesTenant(true, true)).toBe(false);
    expect(disablesTenant(false, true)).toBe(false);
  });
});

describe('disablesTenant from raw values', () => {
  it('reads a value that is not a boolean as not enabled', () => {
    expect(disablesTenant(undefined, false)).toBe(false);
    expect(disablesTenant('true', false)).toBe(false);
    expect(disablesTenant(true, undefined)).toBe(true);
  });
});
