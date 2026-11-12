import { describe, expect, it } from 'vitest';
import {
  REISSUE_INTERVAL_MS,
  bypassesBound,
  reissueAllowed,
  reissueCutoff,
  retryInMinutes,
} from '#/service/authenticators/recovery-reissue';

const NOW = new Date('2032-01-01T12:00:00.000Z');
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);

describe('reissueAllowed', () => {
  it('lets the first set through', () => {
    expect(reissueAllowed(null, { spentAll: false, owed: false }, NOW)).toEqual({ ok: true });
  });

  it('lets a used-up set be replaced at once, however recent the last issue', () => {
    expect(reissueAllowed(ago(1000), { spentAll: true, owed: false }, NOW)).toEqual({ ok: true });
  });

  it('refuses a replacement inside the hour and names when it opens', () => {
    const last = ago(10 * 60_000);
    expect(reissueAllowed(last, { spentAll: false, owed: false }, NOW)).toEqual({
      ok: false,
      retryAt: new Date(last.getTime() + REISSUE_INTERVAL_MS),
    });
  });

  it('lets a set the sign-in is waiting for through at once', () => {
    expect(reissueAllowed(ago(1000), { spentAll: false, owed: true }, NOW)).toEqual({ ok: true });
  });

  it('allows one exactly an hour after the last', () => {
    expect(reissueAllowed(ago(REISSUE_INTERVAL_MS), { spentAll: false, owed: false }, NOW)).toEqual(
      { ok: true },
    );
  });
});

describe('reissueCutoff', () => {
  it('is an hour before now', () => {
    expect(reissueCutoff(NOW)).toEqual(ago(REISSUE_INTERVAL_MS));
  });
});

describe('retryInMinutes', () => {
  it('rounds up, and never says less than one', () => {
    expect(retryInMinutes(new Date(NOW.getTime() + 61_000), NOW)).toBe(2);
    expect(retryInMinutes(new Date(NOW.getTime() + 1), NOW)).toBe(1);
    expect(retryInMinutes(NOW, NOW)).toBe(1);
  });
});

describe('bypassesBound', () => {
  it('is the one rule reissueAllowed follows, for every standing', () => {
    for (const spentAll of [false, true]) {
      for (const owed of [false, true]) {
        const standing = { spentAll, owed };
        expect(reissueAllowed(ago(1000), standing, NOW).ok, JSON.stringify(standing)).toBe(
          bypassesBound(standing),
        );
      }
    }
  });
});
