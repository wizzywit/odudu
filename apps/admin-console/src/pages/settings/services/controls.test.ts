import { describe, expect, it } from 'vitest';
import {
  controlGroups,
  controlViews,
  dependencyReason,
  editedValue,
} from '#/pages/settings/services/controls';
import { SETTINGS_SECTIONS, type SettingsSection } from '#/pages/settings/services/sections';
import { settingEntries, type SettingValue } from '#/pages/settings/services/values';
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

describe('cells', () => {
  it('gives short selects a cell each, so three sit on a row, and long ones two columns', () => {
    const app = viewsOf('authenticators').slice(0, 3);
    expect(app.map((view) => view.cell)).toEqual([{}, {}, {}]);
    expect(viewsOf('client-registration')[0]?.cell).toEqual({ span: 'wide' });
    expect(viewsOf('terms').map((view) => view.cell)).toEqual([{ span: 'wide' }, {}]);
  });
});

describe('numbers', () => {
  it('pick their unit for seconds only, and carry the range the server holds', () => {
    const idle = viewsOf('sessions')[0];
    expect(idle).toMatchObject({ picker: true, min: 60 });
    expect(idle?.control === 'number' ? idle.rangeMessage : '').toContain('Allowed: 1 minute to');
    expect(viewsOf('password')[0]).toMatchObject({ picker: false, min: 8, max: 256 });
  });
});

describe('groups', () => {
  it('gather neighbouring controls of one group, in section order', () => {
    expect(
      controlGroups(viewsOf('authenticators')).map((group) => [group.title, group.controls.length]),
    ).toEqual([
      ['Authenticator app', 3],
      ['Passkeys', 2],
      ['Recovery codes', 2],
    ]);
  });

  it('leave a section with no groups as one untitled run', () => {
    expect(controlGroups(viewsOf('sessions')).map((group) => group.title)).toEqual([undefined]);
  });
});

describe('a setting that depends on another', () => {
  const field = section('password').fields.find((each) => each.name === 'breached_on_error');
  const named = (check: string) =>
    controlViews(
      section('password'),
      { values: { breached_check: check }, fieldErrors: {}, changed: [] },
      {},
    ).find((view) => view.name === 'breached_on_error');

  it('is disabled with its reason until the other holds the value it needs', () => {
    expect(named('dataset')).toMatchObject({
      isDisabled: true,
      description: 'Applies to the remote lookup only.',
    });
    expect(named('off')?.isDisabled).toBe(true);
    expect(named('remote')).toMatchObject({ isDisabled: false });
  });

  it('names no reason for a field that depends on nothing', () => {
    expect(field).toBeDefined();
    expect(
      dependencyReason({ name: 'x', label: 'X', control: 'toggle' }, { breached_check: 'off' }),
    ).toBeUndefined();
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
