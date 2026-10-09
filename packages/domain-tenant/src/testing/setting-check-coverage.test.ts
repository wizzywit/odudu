import { describe, expect, it } from 'vitest';
import { readSettingCheck } from '#/testing/setting-check-coverage';

const COLUMNS = new Set([
  'a',
  'b',
  'c',
  'sso_session_idle_seconds',
  'sso_session_max_seconds',
  'brute_force_max_failures',
  'brute_force_lockout_seconds',
  'brute_force_max_lockout_seconds',
  'brute_force_failure_reset_seconds',
  'client_registration_policy',
  'max_clients',
  'password_min_length',
  'audit_event_types',
]);

// As pg_get_constraintdef prints the CHECKs on `tenants` today
// (packages/db/tests/schema-drift.int.test.ts, EXPECTED_CHECKS).
const CURRENT = [
  'CHECK ((((brute_force_max_failures >= 1) AND (brute_force_max_failures <= 100)) AND ((brute_force_lockout_seconds >= 1) AND (brute_force_lockout_seconds <= 86400)) AND (brute_force_max_lockout_seconds >= brute_force_lockout_seconds) AND ((brute_force_failure_reset_seconds >= 60) AND (brute_force_failure_reset_seconds <= 2592000))))',
  "CHECK ((client_registration_policy = ANY (ARRAY['disabled'::text, 'open'::text, 'token'::text])))",
  'CHECK ((max_clients >= 0))',
  "CHECK ((name ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'::text))",
  'CHECK (((password_min_length >= 8) AND (password_min_length <= 256)))',
  'CHECK ((sso_session_idle_seconds <= sso_session_max_seconds))',
  "CHECK (((audit_event_types @> ARRAY['admin_mutation'::text, 'admin_access'::text]) AND (audit_event_types <@ ARRAY['admin_mutation'::text, 'admin_access'::text, 'authentication'::text, 'session'::text, 'token'::text, 'credential'::text])))",
];

describe('readSettingCheck', () => {
  it.each(CURRENT)('accounts for all of %s', (definition) => {
    expect(readSettingCheck(definition, COLUMNS).leftovers).toEqual([]);
  });

  it('reads an ordering either way round as lower<=upper', () => {
    expect(readSettingCheck('CHECK ((a <= b))', COLUMNS).orderings).toEqual(['a<=b']);
    expect(readSettingCheck('CHECK ((b >= a))', COLUMNS).orderings).toEqual(['a<=b']);
  });

  it.each([
    ['arithmetic', 'CHECK (((a + b) <= c))'],
    ['a cast', 'CHECK ((a <= (b)::integer))'],
    ['a strict comparison', 'CHECK ((a < b))'],
    ['a function call', 'CHECK ((abs(a) <= 10))'],
  ])('reports what it cannot read: %s', (_shape, definition) => {
    expect(readSettingCheck(definition, COLUMNS).leftovers.length).toBeGreaterThan(0);
  });
});
