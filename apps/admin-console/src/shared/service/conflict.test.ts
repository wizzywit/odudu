import { clientSchema, clientScopeSchema, groupSchema, roleSchema } from '@odudu/contracts/admin';
import { expect, it } from 'vitest';
import { describeValue } from '#/shared/service/conflict';
import { BILLING } from '#/testing/clientsFixtures';
import { ENG } from '#/testing/groupsFixtures';
import { AUDITOR } from '#/testing/rolesFixtures';
import { OPENID } from '#/testing/scopesFixtures';

it('reads a value the way a person would type it', () => {
  expect(describeValue('Billing portal')).toBe('Billing portal');
  expect(describeValue(300)).toBe('300');
  expect(describeValue(true)).toBe('on');
  expect(describeValue(false)).toBe('off');
  expect(describeValue(['https://a.example/cb', 'https://b.example/cb'])).toBe(
    'https://a.example/cb, https://b.example/cb',
  );
  expect(describeValue({ tier: 'gold' })).toBe('{"tier":"gold"}');
});

it('never shows a blank for a value that is not there', () => {
  expect(describeValue(null)).toBe('not set');
  expect(describeValue(undefined)).toBe('not set');
  expect(describeValue('')).toBe('empty');
  expect(describeValue([])).toBe('none');
});

// A conflict describes a flag with the default describer, which says "not set"
// for undefined where a flag reads "off". Every flag a section compares is a
// boolean the server must send, so that case cannot arise. A stored session
// draft is JSON and could hold a null there, which now reads "not set"; no
// code path writes one.
const FLAGS = [
  ...[
    'enabled',
    'consent_required',
    'full_scope_allowed',
    'skip_logout_confirmation',
    'require_auth_time',
    'frontchannel_logout_session_required',
    'backchannel_logout_session_required',
    'token_exchange_impersonation_allowed',
  ].map((field) => ['client', clientSchema, BILLING, field] as const),
  ['role', roleSchema, AUDITOR, 'default_for_new_subjects'] as const,
  ['group', groupSchema, ENG, 'default_for_new_subjects'] as const,
  ['scope', clientScopeSchema, OPENID, 'include_in_id_token'] as const,
  ['scope', clientScopeSchema, OPENID, 'include_in_access_token'] as const,
];

it.each(FLAGS.map(([name, schema, answer, field]) => [field, name, schema, answer] as const))(
  '%s of a %s answer must be a boolean',
  (field, _name, schema, answer) => {
    expect(schema.safeParse(answer).success).toBe(true);
    expect(typeof answer[field as keyof typeof answer]).toBe('boolean');
    expect(schema.safeParse({ ...answer, [field]: undefined }).success).toBe(false);
    expect(schema.safeParse({ ...answer, [field]: null }).success).toBe(false);
  },
);
