import { describe, expect, it } from 'vitest';
import { ACTIVITY, BEATS, claimText } from '@site/src/features/landing/services/signInBeats';

describe('the sign-in scene beats', () => {
  it('has seven beats, each with a caption, a time and claims that are named', () => {
    expect(BEATS).toHaveLength(7);
    for (const beat of BEATS) {
      expect(beat.caption.length).toBeGreaterThan(15);
      expect(beat.ms).toBeGreaterThan(1000);
    }
  });

  it('has an activity for rest and for every beat', () => {
    expect(Object.keys(ACTIVITY)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    expect(ACTIVITY[0].routes).toEqual([]);
    expect(ACTIVITY[3].chips).toBe(true);
    expect(ACTIVITY[6].chips).toBe(false);
  });

  it('holds each beat about two and a half seconds, longer where the story is', () => {
    expect(BEATS.map((beat) => beat.ms)).toEqual([2500, 2500, 3000, 2500, 2500, 3400, 2500]);
  });

  it('words each claim the scene names, and leaves an unknown one as it is', () => {
    expect(claimText('passwords')).toBe('Passwords');
    expect(claimText('passkeys')).toBe('Passkeys');
    expect(claimText('authenticator-codes')).toBe('Authenticator codes');
    expect(claimText('single-sign-on')).toBe('Single sign-on across one tenant');
    expect(claimText('back-channel-logout')).toBe('Back-channel logout');
    expect(claimText('something-else')).toBe('something-else');
  });
});
