import { describe, expect, it } from 'vitest';
import { generateTotpSecret, totpCode, totpCounter, verifyTotp } from '#/service/totp';

// RFC 6238 (https://www.rfc-editor.org/rfc/rfc6238), fetched and read directly
// 2026-09-16, appendix A and B. The shared secret is the ASCII string
// "12345678901234567890" for SHA-1 (20 bytes); appendix A's reference
// implementation extends it for SHA-256 and SHA-512 not by padding but by
// continuing the same digit cycle — "1234567890" repeated — out to 32 and 64
// bytes respectively (`seed32`/`seed64` in the Java listing). Base32-encoded,
// with no padding, that gives the three secrets below; each was checked by
// decoding it back to the RFC's own hex seed before use here.
const SEED_SHA1 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const SEED_SHA256 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA';
const SEED_SHA512 =
  'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNA';

describe('[RFC6238-3-01] appendix B, SHA-1, 8 digits', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('at unix time %i produces %s', (seconds, expected) => {
    const counter = totpCounter(new Date(seconds * 1000));
    expect(totpCode(SEED_SHA1, counter, 8, 'SHA-1')).toBe(expected);
  });
});

describe('appendix B, SHA-256, 8 digits', () => {
  it.each([
    [59, '46119246'],
    [1111111109, '68084774'],
    [1111111111, '67062674'],
    [1234567890, '91819424'],
    [2000000000, '90698825'],
    [20000000000, '77737706'],
  ])('at unix time %i produces %s', (seconds, expected) => {
    expect(totpCode(SEED_SHA256, totpCounter(new Date(seconds * 1000)), 8, 'SHA-256')).toBe(
      expected,
    );
  });
});

describe('appendix B, SHA-512, 8 digits', () => {
  it.each([
    [59, '90693936'],
    [1111111109, '25091201'],
    [1111111111, '99943326'],
    [1234567890, '93441116'],
    [2000000000, '38618901'],
    [20000000000, '47863826'],
  ])('at unix time %i produces %s', (seconds, expected) => {
    expect(totpCode(SEED_SHA512, totpCounter(new Date(seconds * 1000)), 8, 'SHA-512')).toBe(
      expected,
    );
  });
});

describe('RFC 4226 appendix D, the HOTP counter values TOTP builds on', () => {
  // RFC 4226 (https://www.rfc-editor.org/rfc/rfc4226), appendix D: the same
  // ASCII secret, digits=6, over the raw counters 0-9 rather than a
  // time-derived one. TOTP is HOTP with T substituted for the counter, so
  // these exercise `totpCode` directly and, across ten counters, touch HMAC
  // digest bytes appendix B's six timestamps happen not to.
  it.each([
    [0, '755224'],
    [1, '287082'],
    [2, '359152'],
    [3, '969429'],
    [4, '338314'],
    [5, '254676'],
    [6, '287922'],
    [7, '162583'],
    [8, '399871'],
    [9, '520489'],
  ])('counter %i produces %s', (counter, expected) => {
    expect(totpCode(SEED_SHA1, counter, 6, 'SHA-1')).toBe(expected);
  });
});

describe('[RFC6238-4.2-01] a step far beyond the year 2038 (year 2603)', () => {
  it('produces the RFC-tabulated T and code for unix time 20000000000', () => {
    const counter = totpCounter(new Date(20000000000 * 1000));
    expect(counter).toBe(0x27bc86aa);
    expect(totpCode(SEED_SHA1, counter, 8, 'SHA-1')).toBe('65353130');
  });
});

describe('totpCounter', () => {
  it('[RFC6238-5.2-02] defaults to a 30-second step', () => {
    expect(totpCounter(new Date(29_999))).toBe(0);
    expect(totpCounter(new Date(30_000))).toBe(1);
  });

  it('honours an explicit step size', () => {
    expect(totpCounter(new Date(59_000), 60)).toBe(0);
    expect(totpCounter(new Date(60_000), 60)).toBe(1);
  });
});

describe('generateTotpSecret', () => {
  it('[RFC6238-3-02] produces a different secret each call', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });

  it('[RFC6238-5.1-01] produces base32 with no padding, the length of a SHA-1 HMAC key', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/u);
    expect(secret).not.toContain('=');
    // 20 bytes, base32-encoded 5 bits at a time: ceil(20 * 8 / 5) = 32 characters.
    expect(secret.length).toBe(32);
  });
});

describe('verifyTotp', () => {
  const secret = SEED_SHA1;
  const now = new Date(59_000);

  it('accepts the current step', () => {
    const code = totpCode(secret, totpCounter(now), 6);
    expect(verifyTotp({ secret, code, now, lastStep: null })).toEqual({ ok: true, step: 1 });
  });

  it('[RFC6238-5.2-01] accepts one step either side, and no further', () => {
    for (const offset of [-1, 1]) {
      const code = totpCode(secret, totpCounter(now) + offset, 6);
      expect(verifyTotp({ secret, code, now, lastStep: null }).ok).toBe(true);
    }
    for (const offset of [-2, 2]) {
      const code = totpCode(secret, totpCounter(now) + offset, 6);
      expect(verifyTotp({ secret, code, now, lastStep: null }).ok).toBe(false);
    }
  });

  it('[RFC6238-5.2-03] refuses a code from a step at or below the last accepted one', () => {
    const step = totpCounter(now);
    const code = totpCode(secret, step, 6);
    expect(verifyTotp({ secret, code, now, lastStep: step })).toEqual({ ok: false });
  });

  it('still refuses a stale step even when a later one in the window would otherwise match', () => {
    const step = totpCounter(now);
    const staleCode = totpCode(secret, step - 1, 6);
    expect(verifyTotp({ secret, code: staleCode, now, lastStep: step - 1 })).toEqual({
      ok: false,
    });
  });

  it('refuses a code of the wrong length without comparing it', () => {
    expect(verifyTotp({ secret, code: '1234', now, lastStep: null })).toEqual({ ok: false });
  });

  it('refuses a code that never matches any step in the window', () => {
    expect(verifyTotp({ secret, code: '000000', now, lastStep: null })).toEqual({ ok: false });
  });
});
