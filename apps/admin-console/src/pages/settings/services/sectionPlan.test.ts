import { describe, expect, it } from 'vitest';
import { sectionKind, settingsSections } from '#/pages/settings/services/sectionPlan';
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
