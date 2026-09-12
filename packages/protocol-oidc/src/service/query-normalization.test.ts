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

describe('[RFC6749-3.1-01] a parameter sent without a value is treated as omitted', () => {
  it.each([
    'client_id',
    'redirect_uri',
    'response_type',
    'scope',
    'state',
    'nonce',
    'code_challenge',
    'code_challenge_method',
  ])('drops an empty %s rather than carrying a zero-length value forward', (key) => {
    const result = normalizeAuthorizeQuery({ response_type: 'code', [key]: '' });
    expect(result).toMatchObject({ kind: 'ok', repeatedKey: null });
    if (result.kind !== 'ok') throw new Error('expected ok');
    expect(result.params[key]).toBeUndefined();
  });

  it('drops an empty value out of a repeated parameter without calling it repeated', () => {
    expect(normalizeAuthorizeQuery({ state: ['', 'only-value'] })).toEqual({
      kind: 'ok',
      params: { state: 'only-value' },
      repeatedKey: null,
    });
  });

  it('treats a parameter whose every value is empty as absent', () => {
    expect(normalizeAuthorizeQuery({ state: ['', ''] })).toEqual({
      kind: 'ok',
      params: {},
      repeatedKey: null,
    });
  });
});

describe('a key carrying a value that could not be read is never singular', () => {
  it.each(['client_id', 'redirect_uri'])(
    'renders for a %s whose second value is not a string',
    (key) => {
      expect(normalizeAuthorizeQuery({ [key]: ['a', 7] })).toMatchObject({
        kind: 'render',
        error: 'invalid_request',
      });
    },
  );

  it('flags a state whose second value is not a string as repeated', () => {
    expect(normalizeAuthorizeQuery({ state: ['a', 7] })).toMatchObject({
      kind: 'ok',
      repeatedKey: 'state',
    });
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
