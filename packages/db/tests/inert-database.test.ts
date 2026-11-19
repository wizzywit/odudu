import { describe, expect, it } from 'vitest';
import { forbiddenDatabase, inertDatabase, watchedDatabase } from '#/testing';

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
    expect(() => typeof db.selectDistinct).toThrow('touched');
    expect(() => typeof db.$count).toThrow('touched');
  });
});

describe('watchedDatabase', () => {
  it('reports the name of whatever is read from it', () => {
    const seen: string[] = [];
    const db = watchedDatabase((name) => {
      seen.push(name);
      throw new Error(name);
    });
    expect(() => typeof db.with).toThrow('with');
    expect(seen).toEqual(['with']);
  });
});
