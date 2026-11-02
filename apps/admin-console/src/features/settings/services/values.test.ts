import { describe, expect, it } from 'vitest';
import type { SettingField } from '#/features/settings/services/sections';
import {
  booleanOf,
  describeSetting,
  listOf,
  numberOf,
  textOf,
  settingEntries,
  settingsRequest,
  settingValue,
} from '#/features/settings/services/values';

const toggle: SettingField = { name: 'verify_email', label: 'Verify email', control: 'toggle' };
const seconds: SettingField = { name: 'login_ttl_seconds', label: 'Login', control: 'seconds' };
const count: SettingField = {
  name: 'password_min_length',
  label: 'Minimum length',
  control: 'count',
  unit: 'characters',
};
const text: SettingField = { name: 'display_name', label: 'Display name', control: 'text' };
const choice: SettingField = {
  name: 'client_registration_policy',
  label: 'Policy',
  control: 'choice',
  options: [
    { id: 'disabled', label: 'Closed' },
    { id: 'open', label: 'Open' },
  ],
};
const set: SettingField = {
  name: 'audit_event_types',
  label: 'Recorded',
  control: 'set',
  options: [
    { id: 'admin_mutation', label: 'Changes by administrators' },
    { id: 'token', label: 'Tokens' },
  ],
};

describe('settingValue', () => {
  it('reads each control from the setting as the server answered it', () => {
    const settings = {
      verify_email: true,
      login_ttl_seconds: 1800,
      password_min_length: 12,
      display_name: null,
      client_registration_policy: 'open',
      audit_event_types: ['admin_mutation', 'token'],
    };
    expect(settingValue(toggle, settings)).toBe(true);
    expect(settingValue(seconds, settings)).toBe(1800);
    expect(settingValue(count, settings)).toBe(12);
    expect(settingValue(text, settings)).toBe('');
    expect(settingValue(choice, settings)).toBe('open');
    expect(settingValue(set, settings)).toEqual(['admin_mutation', 'token']);
  });

  it('reads a setting the answer lacks as off, empty, or not a number', () => {
    expect(settingValue(toggle, {})).toBe(false);
    expect(settingValue(text, {})).toBe('');
    expect(settingValue(set, {})).toEqual([]);
    expect(settingValue(count, {})).toBeNaN();
  });
});

describe('settingEntries', () => {
  it('lists a section by name with its label, value and a reading of it', () => {
    const entries = settingEntries([toggle, seconds], {
      verify_email: true,
      login_ttl_seconds: 90,
    });
    expect(entries.map((entry) => [entry.name, entry.label, entry.value])).toEqual([
      ['verify_email', 'Verify email', true],
      ['login_ttl_seconds', 'Login', 90],
    ]);
    expect(entries[1]?.describe(90)).toBe('90 s · 1 minute 30 seconds');
  });
});

describe('describeSetting', () => {
  it('words a value for a conflict beside the other administrator’s', () => {
    expect(describeSetting(toggle)(true)).toBe('on');
    expect(describeSetting(toggle)(false)).toBe('off');
    expect(describeSetting(count)(12)).toBe('12 characters');
    expect(describeSetting(text)('')).toBe('none');
    expect(describeSetting(text)('Acme')).toBe('Acme');
    expect(describeSetting(choice)('open')).toBe('Open');
    expect(describeSetting(set)(['admin_mutation', 'token'])).toBe(
      'Changes by administrators, Tokens',
    );
    expect(describeSetting(set)([])).toBe('none');
  });
});

describe('settingsRequest', () => {
  it('sends the changes as plain JSON, a set as an array', () => {
    const request = settingsRequest({
      verify_email: true,
      password_min_length: 14,
      audit_event_types: ['admin_mutation'] as readonly string[],
    });
    expect(request).toEqual({
      verify_email: true,
      password_min_length: 14,
      audit_event_types: ['admin_mutation'],
    });
  });

  it('leaves out a number that is not one', () => {
    expect(settingsRequest({ password_min_length: Number.NaN, verify_email: false })).toEqual({
      verify_email: false,
    });
  });
});

describe('the narrowing of an edited value to its control', () => {
  it('gives each control the type it expects, and a default for another', () => {
    expect(booleanOf(true)).toBe(true);
    expect(booleanOf(1)).toBe(false);
    expect(numberOf(7)).toBe(7);
    expect(numberOf('7')).toBeNaN();
    expect(textOf('x')).toBe('x');
    expect(textOf(3)).toBe('');
    expect(listOf(['a'])).toEqual(['a']);
    expect(listOf('a')).toEqual([]);
  });
});
