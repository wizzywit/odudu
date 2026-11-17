import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, nextCursor, startAfter } from '#/service/cursor';

const ID = '01a0a992-4657-7d89-8fbf-3385f54810d4';

describe('cursors', () => {
  it('give back what was encoded for the same list', () => {
    expect(decodeCursor('sessions', encodeCursor('sessions', ID), 'uuid')).toEqual({
      kind: 'ok',
      after: ID,
    });
  });

  it('are refused on another list', () => {
    expect(decodeCursor('credentials', encodeCursor('sessions', ID), 'uuid')).toEqual({
      kind: 'invalid',
    });
  });

  it('are refused when the position is not an id where the list pages by id', () => {
    expect(decodeCursor('sessions', encodeCursor('sessions', "x'; drop"), 'uuid')).toEqual({
      kind: 'invalid',
    });
  });

  it('take any text where the list pages by name', () => {
    expect(decodeCursor('consents', encodeCursor('consents', 'portal'), 'text')).toEqual({
      kind: 'ok',
      after: 'portal',
    });
  });

  it.each(['', 'not base64 !!', 'e30', Buffer.from('sessions').toString('base64url')])(
    'are refused when malformed: %j',
    (raw) => {
      expect(decodeCursor('sessions', raw, 'uuid')).toEqual({ kind: 'invalid' });
    },
  );

  it('are refused past a bound on their length', () => {
    const long = encodeCursor('consents', 'a'.repeat(5000));
    expect(decodeCursor('consents', long, 'text')).toEqual({ kind: 'invalid' });
  });
});

describe('startAfter', () => {
  it('begins at the start when no cursor came', () => {
    expect(startAfter('sessions', undefined, 'uuid')).toEqual({ kind: 'ok', after: undefined });
  });

  it('begins after the position a cursor names', () => {
    expect(startAfter('sessions', encodeCursor('sessions', ID), 'uuid')).toEqual({
      kind: 'ok',
      after: ID,
    });
  });

  it('refuses a cursor that does not read', () => {
    expect(startAfter('sessions', 'junk', 'uuid')).toEqual({ kind: 'invalid' });
  });
});

describe('nextCursor', () => {
  it('names the last position when there is more', () => {
    expect(nextCursor('sessions', true, ID)).toBe(encodeCursor('sessions', ID));
  });

  it('is null on the last page and on an empty one', () => {
    expect(nextCursor('sessions', false, ID)).toBeNull();
    expect(nextCursor('sessions', true, undefined)).toBeNull();
  });
});
