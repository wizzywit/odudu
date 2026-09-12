import { describe, expect, it } from 'vitest';
import { normalizeAuthorizeQuery } from '#/service/query-normalization';

describe('normalizeAuthorizeQuery — single-valued parameters pass through unchanged', () => {
  it('leaves a request with no repeated keys untouched', () => {
    const result = normalizeAuthorizeQuery({
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'https://app.example/callback',
    });
    expect(result).toEqual({
      kind: 'ok',
      params: {
        response_type: 'code',
        client_id: 'client-1',
        redirect_uri: 'https://app.example/callback',
      },
      repeatedKey: null,
    });
  });
});

describe('a repeated client_id or redirect_uri renders — nothing trustworthy to redirect to', () => {
  it.each(['client_id', 'redirect_uri'])('renders invalid_request for repeated %s', (key) => {
    const result = normalizeAuthorizeQuery({
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: 'https://app.example/callback',
      [key]: ['a', 'b'],
    });
    expect(result).toMatchObject({ kind: 'render', error: 'invalid_request' });
  });
});

describe('anything that is not a bag of parameters carries no parameters', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'response_type=code'],
    ['an array', ['response_type=code']],
    ['a number', 7],
  ])('treats %s as an empty request rather than throwing', (_label, raw) => {
    expect(normalizeAuthorizeQuery(raw)).toEqual({ kind: 'ok', params: {}, repeatedKey: null });
  });
});

describe('a non-string value is absent, whatever parser produced it', () => {
  it.each([
    ['a number', 7],
    ['an object', { evil: true }],
    ['a boolean', true],
    ['null', null],
  ])('drops code_challenge given as %s', (_label, value) => {
    const result = normalizeAuthorizeQuery({
      response_type: 'code',
      client_id: 'client-1',
      code_challenge: value,
    });
    expect(result).toMatchObject({ kind: 'ok' });
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.params.code_challenge).toBeUndefined();
    expect(result.params.response_type).toBe('code');
  });

  it('drops non-string entries from a repeated parameter', () => {
    const result = normalizeAuthorizeQuery({ state: [7, 'second'] });
    expect(result).toMatchObject({ kind: 'ok', params: { state: 'second' } });
  });

  it('treats a parameter whose every value is a non-string as absent', () => {
    const result = normalizeAuthorizeQuery({ state: [7, {}] });
    expect(result).toMatchObject({ kind: 'ok', repeatedKey: null });
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.params.state).toBeUndefined();
  });

  it('still renders for a repeated client_id whose values are strings', () => {
    const result = normalizeAuthorizeQuery({ client_id: ['a', 'b'] });
    expect(result).toMatchObject({ kind: 'render', error: 'invalid_request' });
  });
});

describe('a repeated non-trust parameter is reported, not silently resolved', () => {
  it.each(['state', 'scope'])('takes the first value for %s but flags it as repeated', (key) => {
    const result = normalizeAuthorizeQuery({
      response_type: 'code',
      [key]: ['first', 'second'],
    });
    expect(result).toMatchObject({
      kind: 'ok',
      params: { [key]: 'first' },
      repeatedKey: key,
    });
  });

  it('reports only the first repeated key found when several are repeated', () => {
    const result = normalizeAuthorizeQuery({
      state: ['a', 'b'],
      scope: ['c', 'd'],
    });
    expect(result).toMatchObject({ kind: 'ok', repeatedKey: 'state' });
  });
});
