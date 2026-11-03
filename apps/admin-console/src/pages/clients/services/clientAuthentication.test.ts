import { describe, expect, it } from 'vitest';
import {
  authOptions,
  authPayload,
  needsSubjectDn,
} from '#/pages/clients/services/clientAuthentication';

describe('authOptions', () => {
  it('offers a confidential client every method but none', () => {
    expect(authOptions({ type: 'confidential' }).map((each) => each.id)).toEqual([
      'client_secret_basic',
      'client_secret_post',
      'private_key_jwt',
      'tls_client_auth',
    ]);
  });

  it('offers a public client none alone, since the type cannot change', () => {
    expect(authOptions({ type: 'public' }).map((each) => each.id)).toEqual(['none']);
  });
});

describe('authPayload', () => {
  it('keeps the subject only for the method that reads it', () => {
    expect(
      authPayload({
        token_endpoint_auth_method: 'tls_client_auth',
        tls_client_auth_subject_dn: ' CN=a ',
      }),
    ).toEqual({
      token_endpoint_auth_method: 'tls_client_auth',
      tls_client_auth_subject_dn: 'CN=a',
    });
    expect(
      authPayload({
        token_endpoint_auth_method: 'client_secret_post',
        tls_client_auth_subject_dn: 'CN=a',
      }),
    ).toEqual({ token_endpoint_auth_method: 'client_secret_post', tls_client_auth_subject_dn: '' });
    expect(needsSubjectDn('tls_client_auth')).toBe(true);
    expect(needsSubjectDn('private_key_jwt')).toBe(false);
  });
});
