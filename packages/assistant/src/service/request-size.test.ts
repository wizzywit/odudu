import { describe, expect, it } from 'vitest';
import { MAX_OUTPUT_TOKENS, reservationTokens } from '#/service/request-size';

describe('reservationTokens', () => {
  it('counts the fixed part at 2.5 bytes a token and the messages at one a byte', () => {
    expect(reservationTokens({ fixedBytes: 25_000, messagesBytes: 1000 })).toBe(
      10_000 + 1000 + MAX_OUTPUT_TOKENS,
    );
  });

  it('rounds the fixed part up', () => {
    expect(reservationTokens({ fixedBytes: 11, messagesBytes: 0 })).toBe(5 + MAX_OUTPUT_TOKENS);
  });

  it('never goes below what the previous step reported plus the messages added since', () => {
    const previous = { inputTokens: 40_000, messagesBytes: 2000 };
    expect(reservationTokens({ fixedBytes: 25_000, messagesBytes: 5000, previous })).toBe(
      40_000 + 3000 + MAX_OUTPUT_TOKENS,
    );
  });

  it('keeps the byte estimate when it is the larger', () => {
    const previous = { inputTokens: 100, messagesBytes: 2000 };
    expect(reservationTokens({ fixedBytes: 25_000, messagesBytes: 5000, previous })).toBe(
      10_000 + 5000 + MAX_OUTPUT_TOKENS,
    );
  });
});
