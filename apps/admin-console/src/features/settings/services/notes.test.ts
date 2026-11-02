import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS, type SettingField } from '#/features/settings/services/sections';
import { fieldDescription, rangeRule } from '#/features/settings/services/notes';

function field(name: string): SettingField {
  const found = SETTINGS_SECTIONS.flatMap((section) => section.fields).find(
    (each) => each.name === name,
  );
  if (found === undefined) throw new Error(`no field ${name}`);
  return found;
}

describe('rangeRule', () => {
  it('words a duration’s range with its reading', () => {
    expect(rangeRule(field('login_ttl_seconds'))).toBe(
      'Between 60 s · 1 minute and 86400 s · 1 day.',
    );
  });

  it('words a count’s range in its unit', () => {
    expect(rangeRule(field('password_min_length'))).toBe('Between 8 and 256 characters.');
  });

  it('words a range with no top as at least', () => {
    expect(rangeRule(field('max_clients'))).toBe('At least 0 clients.');
    expect(rangeRule(field('refresh_token_ttl_seconds'))).toBe('At least 1 s.');
  });

  it('says nothing for a setting the server holds to no range', () => {
    expect(rangeRule(field('brute_force_max_lockout_seconds'))).toBeNull();
    expect(rangeRule(field('verify_email'))).toBeNull();
  });
});

describe('the client cap', () => {
  it('says it holds however a client is created, not only for registration', () => {
    const text = fieldDescription(field('max_clients'));
    expect(text).toContain('however they are created');
    expect(text).not.toMatch(/registration/u);
  });
});

describe('fieldDescription', () => {
  it('puts what a setting does before the range the server holds it to', () => {
    const text = fieldDescription(field('password_history_depth'));
    expect(text).toMatch(
      /^A new password may not repeat .+ 0 remembers none\. Between 0 and 24 passwords\.$/u,
    );
  });

  it('is only the range when a setting explains nothing more', () => {
    expect(fieldDescription(field('password_min_length'))).toBe('Between 8 and 256 characters.');
  });

  it('is just the range when a setting has no explanation', () => {
    expect(fieldDescription({ name: 'x', label: 'X', control: 'toggle' })).toBeUndefined();
  });
});
