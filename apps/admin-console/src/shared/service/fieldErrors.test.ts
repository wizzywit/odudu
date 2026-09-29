import { expect, it } from 'vitest';
import { fieldErrorsOf } from '#/shared/service/fieldErrors.ts';

const FIELDS = ['name', 'redirect_uris', 'access_token_ttl'] as const;

it('places each structured error under the field its path names', () => {
  expect(
    fieldErrorsOf(
      {
        detail: 'name: must not be empty; access_token_ttl: must be at least 60',
        errors: [
          { path: 'name', message: 'must not be empty' },
          { path: 'access_token_ttl', message: 'must be at least 60' },
        ],
      },
      FIELDS,
    ),
  ).toEqual({
    fields: { name: 'must not be empty', access_token_ttl: 'must be at least 60' },
    other: [],
  });
});

it('keeps the position of an error inside a field', () => {
  expect(
    fieldErrorsOf({ errors: [{ path: 'redirect_uris[1]', message: 'must use https' }] }, FIELDS)
      .fields,
  ).toEqual({ redirect_uris: 'redirect_uris[1]: must use https' });
});

it('joins two errors under one field', () => {
  expect(
    fieldErrorsOf(
      {
        errors: [
          { path: 'redirect_uris[0]', message: 'must use https' },
          { path: 'redirect_uris[2]', message: 'is a duplicate' },
        ],
      },
      FIELDS,
    ).fields,
  ).toEqual({
    redirect_uris: 'redirect_uris[0]: must use https; redirect_uris[2]: is a duplicate',
  });
});

it('trusts `errors` over `detail` when both are present', () => {
  expect(
    fieldErrorsOf(
      { detail: 'name: is taken', errors: [{ path: 'enabled', message: 'is fixed' }] },
      FIELDS,
    ),
  ).toEqual({ fields: {}, other: ['enabled: is fixed'] });
});

it('reads `field: reason` from `detail` only when no `errors` came', () => {
  expect(
    fieldErrorsOf({ detail: 'name: must not be empty; redirect_uris: is required' }, FIELDS),
  ).toEqual({
    fields: { name: 'must not be empty', redirect_uris: 'is required' },
    other: [],
  });
});

it('keeps a detail that names no field of the section as a whole-section message', () => {
  expect(fieldErrorsOf({ detail: 'the tenant is disabled' }, FIELDS)).toEqual({
    fields: {},
    other: ['the tenant is disabled'],
  });
  expect(fieldErrorsOf({ detail: 'cursor: is invalid or expired' }, FIELDS)).toEqual({
    fields: {},
    other: ['cursor: is invalid or expired'],
  });
});

it('says nothing when the refusal says nothing', () => {
  expect(fieldErrorsOf({}, FIELDS)).toEqual({ fields: {}, other: [] });
  expect(fieldErrorsOf({ errors: [] }, FIELDS)).toEqual({ fields: {}, other: [] });
});
