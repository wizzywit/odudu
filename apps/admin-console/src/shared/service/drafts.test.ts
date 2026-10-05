import { describe, expect, it } from 'vitest';
import { draftFieldsOf, keepableValues, withoutDraft } from '#/shared/service/drafts.ts';

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
