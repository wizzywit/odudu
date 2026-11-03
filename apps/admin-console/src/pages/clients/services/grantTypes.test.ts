import { describe, expect, it } from 'vitest';
import { grantOptions, grantsBlock } from '#/pages/clients/services/grantTypes';

describe('grantOptions', () => {
  it('offers the four grants the server takes, in its order', () => {
    const options = grantOptions({ type: 'confidential', grant_types: ['authorization_code'] });
    expect(options.map((each) => each.id)).toEqual([
      'authorization_code',
      'refresh_token',
      'client_credentials',
      'urn:ietf:params:oauth:grant-type:token-exchange',
    ]);
    expect(options.every((each) => each.unavailable === null)).toBe(true);
  });

  it('keeps client credentials from a public client that does not hold it', () => {
    const options = grantOptions({ type: 'public', grant_types: ['authorization_code'] });
    expect(options.find((each) => each.id === 'client_credentials')?.unavailable).toMatch(
      /no secret/u,
    );
    const held = grantOptions({ type: 'public', grant_types: ['client_credentials'] });
    expect(held.find((each) => each.id === 'client_credentials')?.unavailable).toBeNull();
  });
});

describe('grantsBlock', () => {
  it('lets client credentials alone stand with no redirect URI', () => {
    expect(grantsBlock(['client_credentials'], 0)).toBeUndefined();
  });

  it('holds back any other set while there is no redirect URI', () => {
    expect(grantsBlock(['authorization_code'], 0)).toMatch(/no redirect URI/u);
    expect(grantsBlock(['client_credentials', 'refresh_token'], 0)).toMatch(/no redirect URI/u);
    expect(grantsBlock([], 0)).toMatch(/no redirect URI/u);
  });

  it('holds nothing back once a redirect URI is registered', () => {
    expect(grantsBlock(['authorization_code', 'refresh_token'], 1)).toBeUndefined();
  });
});
