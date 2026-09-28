import { describe, expect, it } from 'vitest';
import {
  changedUnderneath,
  current,
  dirtyFields,
  discard,
  edit,
  isDirty,
  rebase,
  startDraft,
} from '#/shared/service/dirty.ts';

const LOADED: {
  name: string;
  access_token_ttl: number;
  redirect_uris: readonly string[];
  claims: Readonly<Record<string, string>>;
} = {
  name: 'Billing portal',
  access_token_ttl: 300,
  redirect_uris: ['https://billing.example.com/cb'],
  claims: { tier: 'gold' },
};

describe('a draft', () => {
  it('starts clean, showing what was loaded', () => {
    const draft = startDraft(LOADED);
    expect(isDirty(draft)).toBe(false);
    expect(dirtyFields(draft)).toEqual([]);
    expect(current(draft)).toEqual(LOADED);
  });

  it('marks exactly the fields that differ from what was loaded', () => {
    const draft = edit(edit(startDraft(LOADED), 'name', 'Billing'), 'access_token_ttl', 600);
    expect(dirtyFields(draft)).toEqual(['name', 'access_token_ttl']);
    expect(current(draft)).toEqual({ ...LOADED, name: 'Billing', access_token_ttl: 600 });
  });

  it('is clean again when a field is edited back to its loaded value', () => {
    const draft = edit(edit(startDraft(LOADED), 'name', 'Billing'), 'name', 'Billing portal');
    expect(isDirty(draft)).toBe(false);
  });

  it('compares lists and maps by what they hold, not by identity', () => {
    const same = edit(
      edit(startDraft(LOADED), 'redirect_uris', ['https://billing.example.com/cb']),
      'claims',
      { tier: 'gold' },
    );
    expect(isDirty(same)).toBe(false);
    const reordered = edit(startDraft(LOADED), 'redirect_uris', [
      'https://billing.example.com/cb',
      'https://billing.example.com/alt',
    ]);
    expect(dirtyFields(reordered)).toEqual(['redirect_uris']);
    expect(dirtyFields(edit(startDraft(LOADED), 'claims', { tier: 'gold', x: '1' }))).toEqual([
      'claims',
    ]);
  });

  it('discards every edit', () => {
    const draft = discard(edit(startDraft(LOADED), 'name', 'Billing'));
    expect(isDirty(draft)).toBe(false);
    expect(current(draft)).toEqual(LOADED);
  });
});

describe('re-basing a draft on a fresh read', () => {
  const edited = edit(startDraft(LOADED), 'name', 'Billing');
  const fresh = { ...LOADED, access_token_ttl: 900 };

  it('keeps the unsaved edits and takes every other field from the fresh read', () => {
    const rebased = rebase(edited, fresh);
    expect(current(rebased)).toEqual({ ...fresh, name: 'Billing' });
    expect(dirtyFields(rebased)).toEqual(['name']);
  });

  it('drops an edit the fresh read already holds', () => {
    expect(isDirty(rebase(edited, { ...fresh, name: 'Billing' }))).toBe(false);
  });

  it('names the edited fields somebody else changed in the meantime', () => {
    const theirs = { ...LOADED, name: 'Billing (EU)', access_token_ttl: 900 };
    expect(changedUnderneath(edited, theirs)).toEqual(['name']);
    expect(changedUnderneath(edited, fresh)).toEqual([]);
  });
});
