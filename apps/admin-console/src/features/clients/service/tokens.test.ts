import { describe, expect, it } from 'vitest';
import { AUTO } from '#/features/clients/service/choices.ts';
import {
  grantOptions,
  grantsBlock,
  idTokenAlgOptions,
  LIFETIMES,
  lifetimeBounds,
  lifetimeRule,
  tenantLifetimeLabel,
} from '#/features/clients/service/tokens.ts';

describe('the lifetimes a client may be given', () => {
  it('names the three the server holds, each with the range it holds them to', () => {
    expect(LIFETIMES.map((each) => each.field)).toEqual([
      'access_token_ttl_seconds',
      'id_token_ttl_seconds',
      'refresh_token_ttl_seconds',
    ]);
    expect(lifetimeBounds('access_token_ttl_seconds')).toEqual({ min: 1, max: 3600 });
    expect(lifetimeBounds('refresh_token_ttl_seconds')).toEqual({ min: 1, max: undefined });
  });

  it('says the range with its duration reading', () => {
    expect(lifetimeRule('id_token_ttl_seconds')).toBe('Between 1 s and 3600 s · 1 hour.');
    expect(lifetimeRule('refresh_token_ttl_seconds')).toBe('At least 1 s.');
  });

  it('starts every lifetime within the range', () => {
    for (const each of LIFETIMES) {
      const { min, max } = lifetimeBounds(each.field);
      expect(each.start).toBeGreaterThanOrEqual(min);
      expect(each.start).toBeLessThanOrEqual(max ?? Number.MAX_SAFE_INTEGER);
    }
  });
});

describe('tenantLifetimeLabel', () => {
  it('names the lifetime it hands back, so three toggles are told apart', () => {
    expect(tenantLifetimeLabel('Access token lifetime')).toBe(
      "Use the tenant's access token lifetime",
    );
  });
});

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

describe('idTokenAlgOptions', () => {
  it('offers the tenant key first and then each algorithm a key can be made for', () => {
    expect(idTokenAlgOptions().map((each) => each.id)).toEqual([AUTO, 'RS256', 'ES256']);
  });
});
