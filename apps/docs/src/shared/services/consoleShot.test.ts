import { describe, expect, it } from 'vitest';
import { captureAddress, loadingFor, sizeOf } from '@site/src/shared/services/consoleShot';

describe('the console picture service', () => {
  it('reads a picture size from the manifest and names its two captures', () => {
    expect(sizeOf('clients')).toEqual({ width: 1100, height: 900 });
    expect(captureAddress('clients', 'dark')).toBe('/console/clients-dark.webp');
  });

  it('refuses a page the manifest does not know', () => {
    expect(() => sizeOf('no-such-page')).toThrow('no console capture named no-such-page');
  });

  it('fetches a priority picture first and any other lazily', () => {
    expect(loadingFor(true)).toEqual({ fetchPriority: 'high', loading: undefined });
    expect(loadingFor(false)).toEqual({ fetchPriority: undefined, loading: 'lazy' });
  });
});
