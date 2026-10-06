import { expect, it } from 'vitest';
import {
  CLIENT_TABS,
  clientRecord,
  clientTabHref,
  TAB_SECTIONS,
  tabsWithEdits,
} from '#/features/clients/service/tabs.ts';

it('keeps the tabs in the order the record page shows them', () => {
  expect(CLIENT_TABS).toEqual([
    'general',
    'redirects',
    'tokens',
    'scopes',
    'logout',
    'advanced',
    'activity',
  ]);
  expect(clientRecord('c1')).toBe('clients/c1');
  expect(clientTabHref('acme', 'c1', 'logout')).toBe('/console/acme/clients/c1?tab=logout');
});

it('marks the tab whose section holds edits, and no other', () => {
  expect([...tabsWithEdits(new Set(['origins']))]).toEqual(['redirects']);
  expect([...tabsWithEdits(new Set(['details', 'redirects']))]).toEqual(['general', 'redirects']);
  expect(tabsWithEdits(new Set())).toEqual(new Set());
});

it('names each section once', () => {
  const all = Object.values(TAB_SECTIONS).flat();
  expect(new Set(all).size).toBe(all.length);
});
