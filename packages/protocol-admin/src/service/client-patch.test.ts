import { describe, expect, it } from 'vitest';
import {
  AMENDABLE_CLIENT_FIELDS,
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
