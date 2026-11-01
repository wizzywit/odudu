import { expect, it } from 'vitest';
import {
  fieldErrorsOf,
  onlyField,
  problemAt,
  requiredProblem,
  withoutField,
} from '#/shared/service/fieldErrors';

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
    refusals: {
      name: [{ path: 'name', message: 'must not be empty' }],
      access_token_ttl: [{ path: 'access_token_ttl', message: 'must be at least 60' }],
    },
  });
});

it('keeps the line, column and code of a refusal, under the field it belongs to', () => {
  const error = {
    path: 'stylesheet',
    message: 'The property is not allowed.',
    code: 'property-not-allowed',
    detail: 'behavior',
    line: 2,
    column: 3,
  };
  const other = { path: 'elsewhere', message: 'x', line: 1 };
  expect(fieldErrorsOf({ errors: [error, other] }, ['stylesheet']).refusals).toEqual({
    stylesheet: [error],
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
  ).toEqual({ fields: {}, other: ['enabled: is fixed'], refusals: {} });
});

it('reads `field: reason` from `detail` only when no `errors` came', () => {
  expect(
    fieldErrorsOf({ detail: 'name: must not be empty; redirect_uris: is required' }, FIELDS),
  ).toEqual({
    fields: { name: 'must not be empty', redirect_uris: 'is required' },
    other: [],
    refusals: {
      name: [{ path: 'name', message: 'must not be empty' }],
      redirect_uris: [{ path: 'redirect_uris', message: 'is required' }],
    },
  });
});

it('keeps a detail that names no field of the section as a whole-section message', () => {
  expect(fieldErrorsOf({ detail: 'the tenant is disabled' }, FIELDS)).toEqual({
    fields: {},
    other: ['the tenant is disabled'],
    refusals: {},
  });
  expect(fieldErrorsOf({ detail: 'cursor: is invalid or expired' }, FIELDS)).toEqual({
    fields: {},
    other: ['cursor: is invalid or expired'],
    refusals: {},
  });
});

it('falls back to the detail, then the title, when nothing names a field', () => {
  expect(fieldErrorsOf({ detail: 'the body is not JSON', errors: [] }, FIELDS)).toEqual({
    fields: {},
    other: ['the body is not JSON'],
    refusals: {},
  });
  expect(fieldErrorsOf({ title: 'Bad Request', errors: [] }, FIELDS)).toEqual({
    fields: {},
    other: ['Bad Request'],
    refusals: {},
  });
  expect(fieldErrorsOf({}, FIELDS)).toEqual({ fields: {}, other: [], refusals: {} });
});

it('drops one field from the errors and leaves the rest', () => {
  const errors = { name: 'a', description: 'b' };
  expect(withoutField(errors, 'name')).toEqual({ description: 'b' });
  expect(withoutField({}, 'name')).toEqual({});
  expect(errors).toEqual({ name: 'a', description: 'b' });
});

it('drops a key from any record that is keyed by name, whatever it holds', () => {
  expect(withoutField<'reset' | 'actions', number>({ reset: 1, actions: 2 }, 'reset')).toEqual({
    actions: 2,
  });
});

it('asks for a value only when it is blank', () => {
  expect(requiredProblem('', 'Enter a name.')).toBe('Enter a name.');
  expect(requiredProblem('  ', 'Enter a name.')).toBe('Enter a name.');
  expect(requiredProblem('x', 'Enter a name.')).toBeNull();
});

it('names the one field that is wrong, and nothing else', () => {
  expect(onlyField('name', 'Enter a name.')).toEqual({ name: 'Enter a name.' });
});

it('names the field a problem is at, or no problem when there is none', () => {
  expect(problemAt('name', 'Enter a name.')).toEqual({ field: 'name', text: 'Enter a name.' });
  expect(problemAt('name', null)).toBeNull();
});
