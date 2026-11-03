import { describe, expect, it } from 'vitest';
import { isAuthEnded } from '#/shared/lib/services/authEnded';

describe('isAuthEnded', () => {
  it('is true for the gateway session-ended type', () => {
    expect(
      isAuthEnded({
        type: 'about:blank#console-session-ended',
        status: 401,
      }),
    ).toBe(true);
  });

  it('is false for a plain 401 the admin API passes back', () => {
    expect(isAuthEnded({ type: 'about:blank', status: 401 })).toBe(false);
  });
});
