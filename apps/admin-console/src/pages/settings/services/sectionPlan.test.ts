import { describe, expect, it } from 'vitest';
import {
  bandAfter,
  bandKey,
  bandTargets,
  currentSection,
  sectionKind,
  settingsNav,
  settingsSections,
} from '#/pages/settings/services/sectionPlan';
import { SETTINGS_SECTIONS } from '#/pages/settings/services/sections';

describe('sectionKind', () => {
  it('singles out the section that asks before disabling, the password one and the lockouts', () => {
    expect(sectionKind('general')).toBe('general');
    expect(sectionKind('password')).toBe('password');
    expect(sectionKind('brute-force')).toBe('lockouts');
    expect(sectionKind('sessions')).toBe('plain');
  });
});

describe('settingsSections', () => {
  it('plans every section in order, with the heading id the page sends focus to', () => {
    const { plans } = settingsSections();
    expect(plans.map((plan) => plan.section.id)).toEqual(SETTINGS_SECTIONS.map((s) => s.id));
    expect(plans[0]).toMatchObject({ title: 'General', headingId: 'settings-general' });
  });

  it('names the page’s own words', () => {
    expect(settingsSections().words).toMatchObject({
      navLabel: 'On this page',
      loading: 'Loading the settings',
    });
  });
});

describe('settingsNav', () => {
  const { plans } = settingsSections();

  it('lists every section under its group, in page order', () => {
    const nav = settingsNav(plans, new Set());
    expect(nav.map((group) => group.title)).toEqual([
      'Tenant',
      'Sign-in',
      'Sessions and tokens',
      'Applications',
      'Records',
    ]);
    expect(nav.flatMap((group) => group.items.map((item) => item.id))).toEqual(
      plans.map((plan) => plan.section.id),
    );
  });

  it('marks the sections with unsaved edits', () => {
    const items = settingsNav(plans, new Set(['sessions'])).flatMap((group) => group.items);
    expect(items.filter((item) => item.dirty).map((item) => item.id)).toEqual(['sessions']);
  });
});

describe('currentSection', () => {
  const order = ['general', 'terms', 'profile'];

  it('is the first section in the band, in page order', () => {
    expect(currentSection(order, new Set(['profile', 'terms']), 'general')).toBe('terms');
  });

  it('stays on the last one while none is in the band', () => {
    expect(currentSection(order, new Set(), 'terms')).toBe('terms');
    expect(currentSection(order, new Set(), null)).toBeNull();
  });
});

describe('the reading band', () => {
  const nav = settingsNav(settingsSections().plans, new Set());

  it('names the observed sections as a key that reads back', () => {
    const key = bandKey(nav);
    expect(bandTargets(key)[0]).toEqual({ id: 'general', headingId: 'settings-general' });
    expect(bandTargets(key)).toHaveLength(15);
    expect(bandTargets('')).toEqual([]);
  });

  it('adds a section that enters and drops one that leaves, without changing the set it was given', () => {
    const was = new Set(['a']);
    const next = bandAfter(was, [
      { id: 'b', intersecting: true },
      { id: 'a', intersecting: false },
    ]);
    expect([...next]).toEqual(['b']);
    expect([...was]).toEqual(['a']);
  });
});
