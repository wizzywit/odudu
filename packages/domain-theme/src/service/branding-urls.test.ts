import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assetPath, stylesheetPath } from '#/service/branding-urls';

describe('assetPath', () => {
  it('names the tenant, the hash and the type', () => {
    expect(assetPath('acme', 'ab'.repeat(32), 'image/png')).toBe(
      `/tenants/acme/brand/${'ab'.repeat(32)}.png`,
    );
    expect(assetPath('acme', 'cd', 'image/jpeg')).toBe('/tenants/acme/brand/cd.jpg');
    expect(assetPath('acme', 'cd', 'image/webp')).toBe('/tenants/acme/brand/cd.webp');
  });

  it('refuses a type no upload produces, SVG included', () => {
    expect(assetPath('acme', 'cd', 'image/svg+xml')).toBeNull();
    expect(assetPath('acme', 'cd', 'text/html')).toBeNull();
  });

  it('encodes the tenant name', () => {
    expect(assetPath('a b/../c', 'cd', 'image/png')).toBe('/tenants/a%20b%2F..%2Fc/brand/cd.png');
  });
});

describe('stylesheetPath', () => {
  it('is the hash of the css, so it changes with it', () => {
    const hash = createHash('sha256').update('a{}').digest('hex');
    expect(stylesheetPath('acme', 'a{}')).toBe(`/tenants/acme/brand/${hash}.css`);
    expect(stylesheetPath('acme', 'b{}')).not.toBe(stylesheetPath('acme', 'a{}'));
  });
});
