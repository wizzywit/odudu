import { expect, it } from 'vitest';
import {
  CLIENT_TABS,
  chosenTab,
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
    'roles',
    'service',
    'sessions',
    'activity',
  ]);
  expect(clientRecord('c1')).toBe('clients/c1');
  expect(clientTabHref('acme', 'c1', 'logout')).toBe('/console/acme/clients/c1?tab=logout');
});

it('marks the tab whose section holds edits, and no other', () => {
  expect([...tabsWithEdits(new Set(['origins']))]).toEqual(['redirects']);
  expect([...tabsWithEdits(new Set(['details', 'redirects']))]).toEqual(['general', 'redirects']);
  expect(tabsWithEdits(new Set())).toEqual(new Set());
  expect([...tabsWithEdits(new Set(['grants', 'frontchannel', 'keys']))]).toEqual([
    'tokens',
    'logout',
    'advanced',
  ]);
});

it('names each section once', () => {
  const all = Object.values(TAB_SECTIONS).flat();
  expect(new Set(all).size).toBe(all.length);
});

it('narrows a tab name to a tab, and to none for one that is not', () => {
  expect(chosenTab('redirects')).toBe('redirects');
  expect(chosenTab('nonsense')).toBeUndefined();
});
