import { describe, expect, it } from 'vitest';
import {
  mayRetireServiceAccount,
  needsServiceAccount,
  retiresServiceAccount,
} from '#/service/service-account';

describe('needsServiceAccount', () => {
  it('is true only for a confidential client that holds client_credentials', () => {
    expect(needsServiceAccount('confidential', ['client_credentials'])).toBe(true);
    expect(needsServiceAccount('confidential', ['authorization_code', 'client_credentials'])).toBe(
      true,
    );
  });

  it('is false for a confidential client without the grant', () => {
    expect(needsServiceAccount('confidential', ['authorization_code', 'refresh_token'])).toBe(
      false,
    );
    expect(needsServiceAccount('confidential', [])).toBe(false);
  });

  it('is false for a public client whatever its grants say', () => {
    expect(needsServiceAccount('public', ['client_credentials'])).toBe(false);
  });
});

describe('retiring', () => {
  it('may happen only to a client with an account whose grants changed', () => {
    expect(mayRetireServiceAccount(true, true)).toBe(true);
    expect(mayRetireServiceAccount(true, false)).toBe(false);
    expect(mayRetireServiceAccount(false, true)).toBe(false);
  });

  it('happens when the grants left do not need an account', () => {
    expect(retiresServiceAccount(true, true, 'confidential', ['authorization_code'])).toBe(true);
    expect(retiresServiceAccount(true, true, 'confidential', ['client_credentials'])).toBe(false);
    expect(retiresServiceAccount(true, false, 'confidential', ['authorization_code'])).toBe(false);
  });
});
