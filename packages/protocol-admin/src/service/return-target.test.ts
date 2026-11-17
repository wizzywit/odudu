import { describe, expect, it } from 'vitest';
import { chooseReturnUri, returnRequestOf } from '#/service/return-target';

const ONE = ['https://app.example/after'];
const TWO = ['https://app.example/a', 'https://app.example/b'];

describe('chooseReturnUri', () => {
  it('takes the only registered address when none is named', () => {
    expect(chooseReturnUri(ONE, undefined)).toEqual({ kind: 'ok', uri: ONE[0] });
  });

  it('takes a named address that is registered, exactly', () => {
    expect(chooseReturnUri(TWO, 'https://app.example/b')).toEqual({
      kind: 'ok',
      uri: 'https://app.example/b',
    });
    expect(chooseReturnUri(ONE, ONE[0])).toEqual({ kind: 'ok', uri: ONE[0] });
  });

  it('asks for the address when the client registers several or none', () => {
    expect(chooseReturnUri(TWO, undefined)).toEqual({ kind: 'required' });
    expect(chooseReturnUri([], undefined)).toEqual({ kind: 'required' });
  });

  it.each([
    ['one that differs by a slash', 'https://app.example/a/'],
    ['one of another case', 'HTTPS://app.example/a'],
    ['one that only starts like a registered one', 'https://app.example/a/more'],
  ])('refuses %s', (_name, uri) => {
    expect(chooseReturnUri(TWO, uri)).toEqual({ kind: 'unregistered' });
    expect(chooseReturnUri([], uri)).toEqual({ kind: 'unregistered' });
  });
});

describe('returnRequestOf', () => {
  it('names no client when the body names none', () => {
    expect(returnRequestOf({})).toEqual({ kind: 'none' });
  });

  it('names the client, and the address when one is given', () => {
    expect(returnRequestOf({ client_id: 'spa' })).toEqual({ kind: 'named', clientId: 'spa' });
    expect(returnRequestOf({ client_id: 'spa', redirect_uri: 'https://app.example/a' })).toEqual({
      kind: 'named',
      clientId: 'spa',
      redirectUri: 'https://app.example/a',
    });
  });

  it('refuses an address that no client owns', () => {
    expect(returnRequestOf({ redirect_uri: 'https://app.example/a' })).toEqual({
      kind: 'orphan_redirect',
    });
  });
});
