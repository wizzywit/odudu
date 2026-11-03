import { describe, expect, it } from 'vitest';
import { consoleShots, loadingFor, shotCatalogue } from '@site/src/shared/lib/services/pictureShot';

describe('the console picture service', () => {
  it('reads a picture size from the manifest and names its two captures', () => {
    expect(consoleShots.sizeOf('clients')).toEqual({ width: 1100, height: 900 });
    expect(consoleShots.addressOf('clients', 'dark')).toBe('/console/clients-dark.webp');
  });

  it('refuses a page the manifest does not know', () => {
    expect(() => consoleShots.sizeOf('no-such-page')).toThrow(
      'no console capture named no-such-page',
    );
  });

  it('fetches a priority picture first and any other lazily', () => {
    expect(loadingFor(true)).toEqual({ fetchPriority: 'high', loading: undefined });
    expect(loadingFor(false)).toEqual({ fetchPriority: undefined, loading: 'lazy' });
  });
});

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
