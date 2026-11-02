import { describe, expect, it } from 'vitest';
import {
  draftFieldsOf,
  foreignTo,
  isKept,
  keepableValues,
  keptDrafts,
  withoutDraft,
} from '#/shared/services/drafts';

describe('keepableValues', () => {
  it('keeps what is plain and never a secret', () => {
    expect(
      keepableValues({
        name: { kind: 'plain', value: 'a' },
        password: { kind: 'secret', value: 'hunter2' },
      }),
    ).toEqual({ name: 'a' });
  });
});

describe('draftFieldsOf', () => {
  it('marks each edit with its field kind, and an unknown field as secret', () => {
    expect(
      draftFieldsOf(
        { name: 'a', stray: 'b' },
        { name: { kind: 'plain' }, other: { kind: 'secret' } },
      ),
    ).toEqual({ name: { kind: 'plain', value: 'a' }, stray: { kind: 'secret', value: 'b' } });
  });
});

describe('withoutDraft', () => {
  const drafts = {
    'acme/groups/1': { general: { values: {}, etag: 'e' }, roles: { values: {}, etag: 'e' } },
    'acme/groups/2': { general: { values: {}, etag: 'e' } },
  };
  it('drops one section and keeps its siblings', () => {
    expect(
      Object.keys(withoutDraft(drafts, 'acme/groups/1', 'general')['acme/groups/1'] ?? {}),
    ).toEqual(['roles']);
  });
  it('drops a record once its last section goes', () => {
    expect(Object.keys(withoutDraft(drafts, 'acme/groups/2', 'general'))).toEqual([
      'acme/groups/1',
    ]);
  });
  it('leaves everything when the section was never kept', () => {
    expect(withoutDraft(drafts, 'acme/groups/1', 'nope')).toEqual(drafts);
  });
});

describe('keptDrafts', () => {
  const snapshot = (over: Partial<Parameters<typeof keptDrafts>[2][number]> = {}) => ({
    record: 'acme/clients/c1',
    section: 'general',
    dirty: true,
    fields: { name: { kind: 'plain' as const, value: 'Billing' } },
    etag: '"e1"',
    ...over,
  });
  const earlier = {
    owner: 'acme/s1',
    drafts: { 'acme/clients/c2': { general: { values: { name: 'Old' }, etag: null } } },
  };

  it("keeps each dirty section's plain edits with the ETag it loaded, and counts them", () => {
    expect(keptDrafts(null, 'acme/s1', [snapshot()])).toEqual({
      drafts: { 'acme/clients/c1': { general: { values: { name: 'Billing' }, etag: '"e1"' } } },
      kept: 1,
    });
  });
  it('skips a clean section, and one with nothing it may keep', () => {
    expect(keptDrafts(null, 'acme/s1', [snapshot({ dirty: false })])).toEqual({
      drafts: {},
      kept: 0,
    });
    expect(
      keptDrafts(null, 'acme/s1', [
        snapshot({ fields: { password: { kind: 'secret', value: 'x' } } }),
      ]),
    ).toEqual({ drafts: {}, kept: 0 });
  });
  it("adds to what its own owner kept before, and starts again after another owner's", () => {
    expect(keptDrafts(earlier, 'acme/s1', [snapshot()]).drafts).toEqual({
      ...earlier.drafts,
      'acme/clients/c1': { general: { values: { name: 'Billing' }, etag: '"e1"' } },
    });
    expect(keptDrafts(earlier, 'acme/s2', [snapshot()]).drafts).toEqual({
      'acme/clients/c1': { general: { values: { name: 'Billing' }, etag: '"e1"' } },
    });
  });
  it('keeps the sibling sections of a record, and replaces the same one', () => {
    const both = keptDrafts(null, 'acme/s1', [
      snapshot(),
      snapshot({ section: 'tokens', fields: { ttl: { kind: 'plain', value: 5 } } }),
      snapshot({ fields: { name: { kind: 'plain', value: 'Later' } } }),
    ]);
    expect(both.kept).toBe(3);
    expect(both.drafts['acme/clients/c1']).toEqual({
      general: { values: { name: 'Later' }, etag: '"e1"' },
      tokens: { values: { ttl: 5 }, etag: '"e1"' },
    });
  });
});

describe('isKept and foreignTo', () => {
  const stored = {
    owner: 'acme/s1',
    drafts: { r: { general: { values: { a: 1 }, etag: null } } },
  };
  it('says whether a draft is kept for a record and section', () => {
    expect(isKept(stored, 'r', 'general')).toBe(true);
    expect(isKept(stored, 'r', 'tokens')).toBe(false);
    expect(isKept(stored, 'other', 'general')).toBe(false);
  });
  it('says a draft belongs to another administrator, and none belongs to nobody', () => {
    expect(foreignTo(stored, 'acme/s2')).toBe(true);
    expect(foreignTo(stored, 'acme/s1')).toBe(false);
    expect(foreignTo(null, 'acme/s1')).toBe(false);
  });
});
