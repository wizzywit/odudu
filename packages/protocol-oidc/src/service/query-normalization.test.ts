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
