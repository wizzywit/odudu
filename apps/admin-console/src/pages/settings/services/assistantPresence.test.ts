import { expect, it } from 'vitest';
import {
  assistantPresence,
  assistantShown,
  mayChangeAssistant,
  mayReadAssistant,
} from '#/pages/settings/services/assistantPresence';
import { settingsNav, settingsSections } from '#/pages/settings/services/sectionPlan';
import type { Authority } from '#/shared/lib/services/principal';

const held = (...capabilities: Authority['capabilities']): Authority => ({
  capabilities,
  crossTenant: false,
});

it('lets a person who manages or audits the assistant read its settings, and nobody before whoami has answered', () => {
  expect(mayReadAssistant(undefined)).toBe(false);
  expect(mayReadAssistant(held('manage-assistant'))).toBe(true);
  expect(mayReadAssistant(held('read-assistant-activity'))).toBe(true);
  expect(mayReadAssistant(held('manage-tenant', 'use-assistant'))).toBe(false);
});

it('lets only a manager change them', () => {
  expect(mayChangeAssistant(held('manage-assistant'))).toBe(true);
  expect(mayChangeAssistant(held('read-assistant-activity'))).toBe(false);
  expect(mayChangeAssistant(undefined)).toBe(false);
});

const problemOf = (status: number) =>
  ({
    ok: false,
    kind: 'problem',
    problem: { type: 'about:blank', title: 'x', status },
  }) as const;

it('draws nothing for a deployment with no assistant or a caller refused, and waits while it reads', () => {
  const base = { mayRead: true, failure: null } as const;
  expect(assistantPresence({ ...base, status: 'missing', failure: problemOf(404) })).toBe('absent');
  expect(assistantPresence({ ...base, status: 'failed', failure: problemOf(403) })).toBe('absent');
  expect(assistantPresence({ ...base, mayRead: false, status: 'ready' })).toBe('absent');
  expect(assistantPresence({ ...base, status: 'loading' })).toBe('pending');
  expect(assistantPresence({ ...base, status: 'failed', failure: problemOf(500) })).toBe('failed');
  expect(assistantPresence({ ...base, status: 'ready' })).toBe('ready');
});

it('lists the section only once it is ready', () => {
  expect(assistantShown('absent')).toBe(false);
  expect(assistantShown('pending')).toBe(false);
  expect(assistantShown('failed')).toBe(false);
  expect(assistantShown('ready')).toBe(true);
});

it('adds the assistant to the list last, with its unsaved edits marked, and leaves it out otherwise', () => {
  const { plans } = settingsSections();
  const without = settingsNav(plans, new Set());
  expect(without.map((group) => group.title)).not.toContain('Assistant');
  const withIt = settingsNav(plans, new Set(), { shown: true, dirty: new Set(['assistant']) });
  expect(withIt.at(-1)).toEqual({
    title: 'Assistant',
    items: [
      { id: 'assistant', headingId: 'settings-assistant', title: 'Console assistant', dirty: true },
    ],
  });
  expect(withIt.slice(0, -1)).toEqual(without);
});
