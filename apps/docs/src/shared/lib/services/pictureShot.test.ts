import { describe, expect, it } from 'vitest';
import { shotCatalogue } from '@site/src/shared/lib/services/pictureShot';

describe('a picture catalogue', () => {
  const catalogue = shotCatalogue({
    manifest: { one: { width: 3, height: 4 } },
    directory: '/here',
    noun: 'picture',
  });

  it('names the two captures under its directory', () => {
    expect(catalogue.addressOf('one', 'light')).toBe('/here/one-light.webp');
    expect(catalogue.addressOf('one', 'dark')).toBe('/here/one-dark.webp');
  });

  it('reads a size from its manifest, and names its own noun when it refuses', () => {
    expect(catalogue.sizeOf('one')).toEqual({ width: 3, height: 4 });
    expect(() => catalogue.sizeOf('two')).toThrow('no picture named two');
  });
});
