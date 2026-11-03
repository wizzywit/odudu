import { expect, it } from 'vitest';
import { clientHref } from '#/entities/client';
import {
  CLIENT_TABS,
  CLIENT_TAB_LABELS,
  chosenTab,
  clientRecord,
  clientTabHrefOf,
  TAB_SECTIONS,
  tabsWithEdits,
} from '#/pages/clients/services/tabs';

it('keeps the tabs in the order the record page shows them', () => {
  expect(CLIENT_TABS).toEqual([
    'general',
    'redirects',
    'tokens',
    'scopes',
    'logout',
    'branding',
    'advanced',
    'roles',
    'service',
    'sessions',
    'activity',
  ]);
  expect(clientRecord('c1')).toBe('clients/c1');
  expect(clientTabHrefOf(clientHref)('acme', 'c1', 'logout')).toBe(
    '/console/acme/clients/c1?tab=logout',
  );
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

it("marks the service account's tab from the roles it saves on the account's own record", () => {
  expect([...tabsWithEdits(new Set(), new Set(['serviceRoles']))]).toEqual(['service']);
  expect([...tabsWithEdits(new Set(['grants']), new Set(['serviceRoles']))]).toEqual([
    'tokens',
    'service',
  ]);
  expect(tabsWithEdits(new Set(), new Set(['other']))).toEqual(new Set());
});

it('marks the logout tab when the sign-out confirmation holds edits', () => {
  expect([...tabsWithEdits(new Set(['confirmation']))]).toEqual(['logout']);
});

it('names each section once', () => {
  const all = Object.values(TAB_SECTIONS).flat();
  expect(new Set(all).size).toBe(all.length);
});

it('narrows a tab name to a tab, and to none for one that is not', () => {
  expect(chosenTab('redirects')).toBe('redirects');
  expect(chosenTab('nonsense')).toBeUndefined();
});

it('marks the branding tab from the theme saved on the client’s own record', () => {
  expect([...tabsWithEdits(new Set(), new Set(), new Set(['theme']))]).toEqual(['branding']);
  expect([...tabsWithEdits(new Set(['details']), new Set(), new Set(['pages']))]).toEqual([
    'general',
    'branding',
  ]);
  expect(tabsWithEdits(new Set(), new Set(), new Set())).toEqual(new Set());
});

it.each([
  ['general', 'General', ['details', 'translations', 'pages', 'availability', 'consent']],
  ['redirects', 'Redirects & origins', ['redirects', 'origins']],
  ['tokens', 'Tokens', ['lifetimes', 'grants', 'credentials', 'fullScope', 'idToken']],
  ['scopes', 'Scopes', []],
  ['logout', 'Logout', ['postLogout', 'confirmation', 'backchannel', 'frontchannel']],
  ['branding', 'Branding', []],
  ['advanced', 'Advanced', ['auth', 'keys', 'userinfo', 'audiences', 'exchange']],
  ['roles', 'Roles', []],
  ['service', 'Service account', []],
  ['sessions', 'Sessions', []],
  ['activity', 'Activity', []],
] as const)(
  'characterisation: %s is labelled %s, holds %j and is addressed',
  (tab, label, held) => {
    expect(CLIENT_TAB_LABELS[tab]).toBe(label);
    expect(TAB_SECTIONS[tab]).toEqual(held);
    expect(clientTabHrefOf(clientHref)('acme', 'c 1', tab)).toBe(
      `/console/acme/clients/c%201?tab=${tab}`,
    );
    expect(chosenTab(tab)).toBe(tab);
    for (const section of held) expect([...tabsWithEdits(new Set([section]))]).toEqual([tab]);
  },
);
