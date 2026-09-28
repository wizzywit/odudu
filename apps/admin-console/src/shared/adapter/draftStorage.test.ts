import { afterEach, expect, it, vi } from 'vitest';
import { loadDrafts, storeDrafts } from '#/shared/adapter/draftStorage.ts';

const KEY = 'odudu.console.drafts';
const KEPT = {
  owner: 'acme/s1',
  drafts: { 'acme/roles/r1': { general: { etag: '"e1"', values: { name: 'x' } } } },
};

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

it('keeps drafts in this tab alone, and removes the entry once none are left', () => {
  storeDrafts(KEPT);
  expect(localStorage.length).toBe(0);
  expect(loadDrafts()).toEqual(KEPT);
  storeDrafts({ owner: 'acme/s1', drafts: {} });
  expect(sessionStorage.getItem(KEY)).toBeNull();
  storeDrafts(KEPT);
  storeDrafts(null);
  expect(loadDrafts()).toBeNull();
});

it('reads a stored value of the wrong shape, or not JSON, as no drafts', () => {
  sessionStorage.setItem(KEY, '{"owner":1}');
  expect(loadDrafts()).toBeNull();
  sessionStorage.setItem(KEY, 'not json');
  expect(loadDrafts()).toBeNull();
});

it('survives storage that refuses every access, even at the getter', () => {
  vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
    throw new DOMException('denied', 'SecurityError');
  });
  expect(loadDrafts()).toBeNull();
  expect(() => {
    storeDrafts(KEPT);
    storeDrafts(null);
  }).not.toThrow();
});
