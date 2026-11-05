import {
  REGISTRATION_POLICY_SETTINGS,
  tenantSettingsDocumentSchema,
  TENANT_SETTING_ORDERINGS,
  TENANT_SETTING_RANGES,
} from '@odudu/contracts/admin';
import { SETTINGS_WORDS } from '#/pages/settings/services/settingsPageWords';
import { describe, expect, it } from 'vitest';
import {
  PLACED_ELSEWHERE,
  sectionHeadingId,
  SETTINGS_SECTIONS,
} from '#/pages/settings/services/sections';

const EVERY_SETTING = [
  ...Object.keys(tenantSettingsDocumentSchema.shape),
  ...REGISTRATION_POLICY_SETTINGS,
];

const PLACED = SETTINGS_SECTIONS.flatMap((section) => section.fields.map((field) => field.name));

describe('SETTINGS_SECTIONS', () => {
  it('places every tenant setting in a section, or names where else it lives', () => {
    const unplaced = EVERY_SETTING.filter(
      (name) => !PLACED.includes(name) && !Object.hasOwn(PLACED_ELSEWHERE, name),
    );
    expect(unplaced).toEqual([]);
  });

  it('places a setting once', () => {
    expect(PLACED.filter((name, at) => PLACED.indexOf(name) !== at)).toEqual([]);
  });

  it('names no setting the server does not have', () => {
    expect(PLACED.filter((name) => !EVERY_SETTING.includes(name))).toEqual([]);
    expect(Object.keys(PLACED_ELSEWHERE).filter((name) => !EVERY_SETTING.includes(name))).toEqual(
      [],
    );
  });

  it('does not place a setting both here and elsewhere', () => {
    expect(PLACED.filter((name) => Object.hasOwn(PLACED_ELSEWHERE, name))).toEqual([]);
  });

  it('gives every section a distinct id and a title', () => {
    const ids = SETTINGS_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(SETTINGS_SECTIONS.every((section) => section.title !== '')).toBe(true);
  });

  it('puts the two settings an ordering relates in one section, so a refusal lands under its field', () => {
    for (const [lower, upper] of TENANT_SETTING_ORDERINGS) {
      const home = SETTINGS_SECTIONS.find((section) =>
        section.fields.some((field) => field.name === lower),
      );
      expect(home?.fields.some((field) => field.name === upper)).toBe(true);
    }
  });

  it('gives every setting the server holds to a range a number control', () => {
    for (const name of Object.keys(TENANT_SETTING_RANGES)) {
      const control = SETTINGS_SECTIONS.flatMap((section) => section.fields).find(
        (field) => field.name === name,
      )?.control;
      expect(['seconds', 'count']).toContain(control);
    }
  });
});

describe('sectionHeadingId', () => {
  it('is distinct for every section', () => {
    const ids = SETTINGS_SECTIONS.map((section) => sectionHeadingId(section.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

it('says the brute-force section covers wrong second-factor codes as well as passwords', () => {
  const section = SETTINGS_SECTIONS.find((each) => each.id === 'brute-force');
  expect(section?.description).toBe(
    'When repeated wrong passwords or wrong second-factor codes lock an account, and for how long.',
  );
});

describe('the client registration section', () => {
  const section = SETTINGS_SECTIONS.find((each) => each.id === 'client-registration');

  it('holds the policy, with mcp among its options, and the metadata-document switch', () => {
    const policy = section?.fields.find((field) => field.name === 'client_registration_policy');
    expect(policy?.options?.map((option) => option.id)).toEqual([
      'disabled',
      'token',
      'open',
      'mcp',
    ]);
    expect(section?.fields.find((field) => field.name === 'cimd_enabled')?.control).toBe('toggle');
  });

  it('takes its wording from the page’s wording record', () => {
    const policy = section?.fields.find((field) => field.name === 'client_registration_policy');
    const cimd = section?.fields.find((field) => field.name === 'cimd_enabled');
    expect(policy?.options?.find((option) => option.id === 'mcp')?.label).toBe(
      SETTINGS_WORDS.mcpOption,
    );
    expect(cimd?.label).toBe(SETTINGS_WORDS.cimdLabel);
    expect(cimd?.description).toBe(SETTINGS_WORDS.cimdDescription);
  });
});
