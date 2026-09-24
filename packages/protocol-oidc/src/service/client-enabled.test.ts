import { describe, expect, it } from 'vitest';
import { clientIsLive } from '#/service/client-enabled';

describe('clientIsLive', () => {
  it('is true for an enabled client', () => {
    expect(clientIsLive({ enabled: true })).toBe(true);
  });

  it('is false for a disabled client', () => {
    expect(clientIsLive({ enabled: false })).toBe(false);
  });

  it('is false when the client no longer exists', () => {
    expect(clientIsLive(null)).toBe(false);
  });
});
