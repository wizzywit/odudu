import { describe, expect, it } from 'vitest';
import {
  deviceCookie,
  deviceCookieName,
  deviceDigest,
  newDeviceId,
  readDeviceId,
} from '#/service/device-id';

const BYTES = Uint8Array.from({ length: 16 }, (_, index) => index);
const ID = newDeviceId(() => BYTES);

describe('newDeviceId', () => {
  it('encodes the bytes it is given as 22 URL-safe characters', () => {
    expect(ID).toBe('AAECAwQFBgcICQoLDA0ODw');
    expect(ID).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('draws fresh bytes on every call', () => {
    let next = 0;
    const draw = () => Uint8Array.from({ length: 16 }, () => next++);
    expect(newDeviceId(draw)).not.toBe(newDeviceId(draw));
  });

  it('refuses a source that returns too few bytes to be unguessable', () => {
    expect(() => newDeviceId(() => new Uint8Array(8))).toThrow(RangeError);
  });
});

describe('deviceDigest', () => {
  it('is a stable 64-character hex digest that is not the id', () => {
    expect(deviceDigest(ID)).toMatch(/^[0-9a-f]{64}$/);
    expect(deviceDigest(ID)).toBe(deviceDigest(ID));
    expect(deviceDigest(ID)).not.toContain(ID);
  });

  it('differs between devices', () => {
    expect(deviceDigest(ID)).not.toBe(deviceDigest(newDeviceId(() => new Uint8Array(16).fill(9))));
  });
});

describe('the device cookie', () => {
  it('takes the __Host- prefix under TLS and drops it without', () => {
    expect(deviceCookieName('acme', true)).toBe('__Host-acme-device');
    expect(deviceCookieName('acme', false)).toBe('acme-device');
  });

  it('is HttpOnly, same-site, long-lived and Secure only under TLS', () => {
    const secure = deviceCookie('acme', true, ID);
    expect(secure).toBe(
      `__Host-acme-device=${ID}; HttpOnly; SameSite=Lax; Path=/; Secure; Max-Age=34560000`,
    );
    expect(deviceCookie('acme', false, ID)).not.toContain('Secure');
  });

  it('is read back from a Cookie header that carries other cookies', () => {
    expect(readDeviceId(`a=1; acme-device=${ID}; b=2`, 'acme', false)).toBe(ID);
  });

  it('reads nothing from a header without it, or with a malformed value', () => {
    expect(readDeviceId(undefined, 'acme', false)).toBeNull();
    expect(readDeviceId('a=1', 'acme', false)).toBeNull();
    expect(readDeviceId('acme-device=short', 'acme', false)).toBeNull();
    expect(readDeviceId(`acme-device=${ID}x`, 'acme', false)).toBeNull();
  });

  it('skips a planted duplicate of the wrong shape and finds the valid one', () => {
    expect(readDeviceId(`acme-device=bad; acme-device=${ID}`, 'acme', false)).toBe(ID);
  });

  it('does not read another tenant address’s cookie', () => {
    expect(readDeviceId(`other-device=${ID}`, 'acme', false)).toBeNull();
  });
});
