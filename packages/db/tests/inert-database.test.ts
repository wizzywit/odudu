import { describe, expect, it } from 'vitest';
import { forbiddenDatabase, inertDatabase } from '#/testing';

describe('inertDatabase', () => {
  it('is a database with no connection, whose stubbed methods answer', () => {
    const db = inertDatabase({ ping: () => 'pong' });
    expect(db.ping()).toBe('pong');
  });
});

describe('forbiddenDatabase', () => {
  it('names the reason when anything reaches for it', () => {
    const db = forbiddenDatabase('touched');
    expect(() => db.select()).toThrow('touched');
    expect(() => db.insert({} as never)).toThrow('touched');
  });
});
