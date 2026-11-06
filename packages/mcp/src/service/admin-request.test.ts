import { describe, expect, it } from 'vitest';
import { jsonBodyOf } from '#/service/admin-request';

describe('a body read as JSON', () => {
  it.each([
    'application/json',
    'Application/JSON',
    'application/json; charset=utf-8',
    'APPLICATION/JSON ;charset=UTF-8',
    'application/problem+json',
    'Application/Problem+JSON; charset=utf-8',
    'application/vnd.api+json',
  ])('is read when the type is %s', (type) => {
    expect(jsonBodyOf(type, '{"a":1}')).toEqual({ a: 1 });
  });

  it.each([
    'text/html',
    'text/plain; charset=json',
    'application/jsonp',
    'application/x-json-lines',
    '',
    undefined,
  ])('is not read when the type is %j', (type) => {
    expect(jsonBodyOf(type, '{"a":1}')).toBeNull();
  });

  it('is nothing for an empty or malformed body', () => {
    expect(jsonBodyOf('application/json', '')).toBeNull();
    expect(jsonBodyOf('application/json', '{')).toBeNull();
  });
});
