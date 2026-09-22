import { describe, expect, it } from 'vitest';
import { clientSecretLimiterKey, isPasswordAuthMethod } from '#/service/client-secret-throttle';

describe('isPasswordAuthMethod', () => {
  it('is true for client_secret_basic and client_secret_post', () => {
    expect(isPasswordAuthMethod('client_secret_basic')).toBe(true);
    expect(isPasswordAuthMethod('client_secret_post')).toBe(true);
  });

  // private_key_jwt has no /token acceptance path yet (P3b), so this
  // guards a client that does not exist until then: proof of possession of
  // a key is not password authentication, and must never share the budget
  // RFC 6749 §2.3.1 asks for.
  it('is false for private_key_jwt, the P3b client this budget must not reach', () => {
    expect(isPasswordAuthMethod('private_key_jwt')).toBe(false);
  });

  it('is false for none and for an unrecognized method', () => {
    expect(isPasswordAuthMethod('none')).toBe(false);
    expect(isPasswordAuthMethod('tls_client_auth')).toBe(false);
  });
});

describe('clientSecretLimiterKey', () => {
  it('keeps two tenants with the same client_id apart', () => {
    expect(clientSecretLimiterKey('tenant-a', 'shared-client')).not.toBe(
      clientSecretLimiterKey('tenant-b', 'shared-client'),
    );
  });

  it('keeps two clients in the same tenant apart', () => {
    expect(clientSecretLimiterKey('tenant-a', 'client-1')).not.toBe(
      clientSecretLimiterKey('tenant-a', 'client-2'),
    );
  });
});
