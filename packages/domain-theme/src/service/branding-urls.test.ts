import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pathAddress } from '@odudu/kernel';
import { assetPath, stylesheetPath } from '#/service/branding-urls';

const BASE = 'https://id.example.test';

describe('assetPath', () => {
  it('names the tenant, the hash and the type', () => {
    expect(assetPath(pathAddress(BASE, 'acme'), 'ab'.repeat(32), 'image/png')).toBe(
      `/tenants/acme/brand/${'ab'.repeat(32)}.png`,
    );
    expect(assetPath(pathAddress(BASE, 'acme'), 'cd', 'image/jpeg')).toBe(
      '/tenants/acme/brand/cd.jpg',
    );
    expect(assetPath(pathAddress(BASE, 'acme'), 'cd', 'image/webp')).toBe(
      '/tenants/acme/brand/cd.webp',
    );
  });

  it('refuses a type no upload produces, SVG included', () => {
    expect(assetPath(pathAddress(BASE, 'acme'), 'cd', 'image/svg+xml')).toBeNull();
    expect(assetPath(pathAddress(BASE, 'acme'), 'cd', 'text/html')).toBeNull();
  });

  it('encodes the tenant name', () => {
    expect(assetPath(pathAddress(BASE, 'a b/../c'), 'cd', 'image/png')).toBe(
      '/tenants/a%20b%2F..%2Fc/brand/cd.png',
    );
  });
});

describe('stylesheetPath', () => {
  it('is the hash of the css, so it changes with it', () => {
    const hash = createHash('sha256').update('a{}').digest('hex');
    expect(stylesheetPath(pathAddress(BASE, 'acme'), 'a{}')).toBe(
      `/tenants/acme/brand/${hash}.css`,
    );
    expect(stylesheetPath(pathAddress(BASE, 'acme'), 'b{}')).not.toBe(
      stylesheetPath(pathAddress(BASE, 'acme'), 'a{}'),
    );
  });
});
