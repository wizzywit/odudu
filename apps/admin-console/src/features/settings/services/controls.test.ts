import { describe, expect, it } from 'vitest';
import { controlViews, editedValue } from '#/features/settings/services/controls';
import { SETTINGS_SECTIONS, type SettingsSection } from '#/features/settings/services/sections';
import { settingEntries, type SettingValue } from '#/features/settings/services/values';
import { SETTINGS } from '#/testing/settingsFixtures';

function section(id: string): SettingsSection {
  const found = SETTINGS_SECTIONS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no section ${id}`);
  return found;
}

function viewsOf(id: string, fixed: Readonly<Record<string, string>> = {}) {
  const values: Record<string, SettingValue> = {};
  for (const entry of settingEntries(section(id).fields, SETTINGS))
    values[entry.name] = entry.value;
  return controlViews(section(id), { values, fieldErrors: {}, changed: [] }, fixed);
}

describe('controlViews', () => {
  it('gives a toggle and a text their value, and the text a wide cell', () => {
    const [name, enabled] = viewsOf('general');
    expect(name).toMatchObject({
      control: 'text',
      name: 'display_name',
      value: 'Acme',
      cell: { span: 'wide' },
    });
    expect(enabled).toMatchObject({ control: 'toggle', value: true, cell: {}, isDisabled: false });
  });

  it('reads a duration as a number in seconds and a count in its own unit', () => {
    expect(viewsOf('sessions')[0]).toMatchObject({
      control: 'number',
      unit: 'seconds',
      value: 1800,
    });
    expect(viewsOf('password')[0]).toMatchObject({
      control: 'number',
      unit: 'characters',
      value: 15,
    });
  });

  it('gives a choice its options and a set a full cell with the fixed ones unavailable', () => {
    const [policy] = viewsOf('client-registration');
    expect(policy).toMatchObject({ control: 'choice', value: 'disabled', cell: { span: 'wide' } });
    const events = viewsOf('retention').find((view) => view.control === 'set');
    expect(events?.cell).toEqual({ span: 'full' });
    expect(events?.control === 'set' ? events.options.some((o) => o.unavailable) : false).toBe(
      true,
    );
  });

  it('carries the reason for a fixed setting as its description, and disables it', () => {
    const [, enabled] = viewsOf('general', { enabled: 'system cannot be disabled' });
    expect(enabled).toMatchObject({
      description: 'system cannot be disabled',
      isDisabled: true,
    });
  });

  it('carries the error and the edited mark of the field', () => {
    const views = controlViews(
      section('sessions'),
      {
        values: { sso_session_idle_seconds: 1 },
        fieldErrors: { sso_session_idle_seconds: 'too short' },
        changed: ['sso_session_idle_seconds'],
      },
      {},
    );
    expect(views[0]).toMatchObject({ error: 'too short', changed: true });
    expect(views[1]).toMatchObject({ error: undefined, changed: false });
  });
});

describe('editedValue', () => {
  it('keeps the value as it was when a number is cleared', () => {
    expect(editedValue(1800, Number.NaN)).toBe(1800);
    expect(editedValue(1800, 3600)).toBe(3600);
  });

  it('passes a switch, a text and a list through', () => {
    expect(editedValue(false, true)).toBe(true);
    expect(editedValue('a', 'b')).toBe('b');
    expect(editedValue(['a'], ['a', 'b'])).toEqual(['a', 'b']);
  });
});
