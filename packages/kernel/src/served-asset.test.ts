import { describe, expect, it } from 'vitest';
import { servedAssetHeaders } from '#/served-asset';

describe('servedAssetHeaders', () => {
  it('stops an uploaded file acting as a page: no source, no script, a sandbox', () => {
    const headers = new Map(servedAssetHeaders('cross-origin'));
    expect(headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('says who may embed it', () => {
    expect(new Map(servedAssetHeaders('cross-origin')).get('cross-origin-resource-policy')).toBe(
      'cross-origin',
    );
    expect(new Map(servedAssetHeaders('same-origin')).get('cross-origin-resource-policy')).toBe(
      'same-origin',
    );
  });
});
