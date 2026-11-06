import { describe, expect, it } from 'vitest';
import { needsServiceAccount } from '#/service/service-account';

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
