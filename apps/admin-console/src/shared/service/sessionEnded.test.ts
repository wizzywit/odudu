import { describe, expect, it } from 'vitest';
import { isSessionEnded } from '#/shared/service/sessionEnded.ts';

describe('isSessionEnded', () => {
  it('is true for the gateway session-ended type', () => {
    expect(
      isSessionEnded({
        type: 'about:blank#console-session-ended',
        status: 401,
      }),
    ).toBe(true);
  });

  it('is false for a plain 401 the admin API passes back', () => {
    expect(isSessionEnded({ type: 'about:blank', status: 401 })).toBe(false);
  });
});
