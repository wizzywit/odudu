import { describe, expect, it } from 'vitest';
import {
  AMENDABLE_CLIENT_FIELDS,
  BUILTIN_ADMIN_AMENDABLE_FIELDS,
  BUILTIN_ADMIN_GUARDED_FIELDS,
  CLIENT_COLUMNS,
  CLIENT_OIDC_CONFIG_COLUMNS,
  refusalFor,
} from '#/service/client-patch';

describe('the client amendment allowlist', () => {
  // 24, not the 25 once guessed by hand: `clients` carries a twelfth
  // column, `builtin_admin`, which needs its own refusal reason rather
  // than falling silently into either list — the fourth test below is
  // what catches a column like it.
  it('admits the three mutable columns on clients and 21 of 23 on client_oidc_config', () => {
    expect(AMENDABLE_CLIENT_FIELDS).toHaveLength(24);
    for (const field of [
      'name',
      'enabled',
      'full_scope_allowed',
      'redirect_uris',
      'grant_types',
      'token_exchange_impersonation_allowed',
      'tls_client_auth_subject_dn',
      'userinfo_signed_response_alg',
    ]) {
      expect(AMENDABLE_CLIENT_FIELDS, field).toContain(field);
    }
  });

  it('refuses identity, history, provenance, the secret and the type, each with a reason', () => {
    for (const field of [
      'id',
      'tenant_id',
      'client_id',
      'created_at',
      'registration_origin',
      'service_subject_id',
      'secret_hash',
      'type',
    ]) {
      expect(refusalFor(field), field).toEqual(expect.any(String));
    }
  });

  it('gives an amendable field no refusal', () => {
    expect(refusalFor('redirect_uris')).toBeNull();
  });

  it('accounts for every column of both tables', () => {
    // A column added later is either amendable or refused with a reason —
    // never silently neither, which is how a field becomes unreachable.
    for (const column of [...CLIENT_COLUMNS, ...CLIENT_OIDC_CONFIG_COLUMNS]) {
      const known = AMENDABLE_CLIENT_FIELDS.includes(column) || refusalFor(column) !== null;
      expect(known, column).toBe(true);
    }
  });
});

describe('the narrower allowlist the built-in admin client is amended through', () => {
  it('admits nine fields nothing about reaching the admin API depends on', () => {
    expect([...BUILTIN_ADMIN_AMENDABLE_FIELDS].sort()).toEqual([
      'backchannel_logout_session_required',
      'backchannel_logout_uri',
      'consent_required',
      'frontchannel_logout_session_required',
      'frontchannel_logout_uri',
      'name',
      'userinfo_encrypted_response_alg',
      'userinfo_encrypted_response_enc',
      'userinfo_signed_response_alg',
    ]);
  });

  // Stated whole rather than counted: a column added to `clients` or
  // `client_oidc_config` is refused on this one client by default, and
  // this is what forces somebody to say so deliberately instead of
  // discovering it when an administrator is locked out.
  it('guards the other fifteen, admission-bearing or not yet judged', () => {
    expect([...BUILTIN_ADMIN_GUARDED_FIELDS].sort()).toEqual([
      'access_token_ttl_seconds',
      'audiences',
      'client_credentials_scopes',
      'enabled',
      'full_scope_allowed',
      'grant_types',
      'jwks',
      'jwks_uri',
      'post_logout_redirect_uris',
      'redirect_uris',
      'refresh_token_ttl_seconds',
      'tls_client_auth_subject_dn',
      'token_endpoint_auth_method',
      'token_exchange_impersonation_allowed',
      'web_origins',
    ]);
  });

  it('classifies every amendable field as one or the other', () => {
    for (const field of AMENDABLE_CLIENT_FIELDS) {
      const classified =
        BUILTIN_ADMIN_AMENDABLE_FIELDS.includes(field) ||
        BUILTIN_ADMIN_GUARDED_FIELDS.includes(field);
      expect(classified, field).toBe(true);
    }
    expect(BUILTIN_ADMIN_AMENDABLE_FIELDS.length + BUILTIN_ADMIN_GUARDED_FIELDS.length).toEqual(
      AMENDABLE_CLIENT_FIELDS.length,
    );
  });
});
