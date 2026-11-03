import { describe, expect, it } from 'vitest';
import { AUTO } from '#/pages/clients/services/choices';
import {
  userinfoContentOptions,
  userinfoEncryptionOptions,
  userinfoPayload,
  userinfoSigningOptions,
} from '#/pages/clients/services/userinfoResponse';

describe('userinfo', () => {
  it('offers the algorithms the server signs and encrypts with', () => {
    expect(userinfoSigningOptions().map((each) => each.id)).toEqual([
      AUTO,
      'RS256',
      'ES256',
      'none',
    ]);
    expect(userinfoEncryptionOptions().map((each) => each.id)).toEqual([
      AUTO,
      'RSA-OAEP-256',
      'ECDH-ES',
      'ECDH-ES+A128KW',
      'ECDH-ES+A192KW',
      'ECDH-ES+A256KW',
    ]);
    expect(userinfoContentOptions()[0]?.label).toBe('Default (A128CBC-HS256)');
  });

  it('drops the content encryption with the algorithm it goes with', () => {
    expect(
      userinfoPayload({
        userinfo_signed_response_alg: 'RS256',
        userinfo_encrypted_response_alg: AUTO,
        userinfo_encrypted_response_enc: 'A256GCM',
      }),
    ).toEqual({
      userinfo_signed_response_alg: 'RS256',
      userinfo_encrypted_response_alg: null,
      userinfo_encrypted_response_enc: null,
    });
    expect(
      userinfoPayload({
        userinfo_signed_response_alg: AUTO,
        userinfo_encrypted_response_alg: 'ECDH-ES',
        userinfo_encrypted_response_enc: 'A256GCM',
      }),
    ).toEqual({
      userinfo_signed_response_alg: null,
      userinfo_encrypted_response_alg: 'ECDH-ES',
      userinfo_encrypted_response_enc: 'A256GCM',
    });
  });
});
