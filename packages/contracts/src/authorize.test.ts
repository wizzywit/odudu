import { describe, expect, it } from 'vitest';
import { authorizeQuerySchema } from '#/authorize';

const required = {
  response_type: 'code',
  client_id: 'client-1',
  redirect_uri: 'https://app.example/callback',
  code_challenge: 'a'.repeat(43),
  code_challenge_method: 'S256',
};

describe('authorizeQuerySchema', () => {
  it('accepts a request with only the required fields', () => {
    expect(authorizeQuerySchema.safeParse(required).success).toBe(true);
  });

  it('accepts nonce and the OIDC Core §3.1.2.1 optional parameters', () => {
    const result = authorizeQuerySchema.safeParse({
      ...required,
      nonce: 'a-nonce',
      display: 'page',
      prompt: 'login',
      max_age: '3600',
      ui_locales: 'en',
      login_hint: 'someone@example.com',
      id_token_hint: 'header.payload.signature',
      acr_values: 'urn:mace:incommon:iap:silver',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nonce).toBe('a-nonce');
    }
  });
});
