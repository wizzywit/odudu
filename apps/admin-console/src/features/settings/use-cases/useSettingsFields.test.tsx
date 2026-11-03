import { act, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useSettingsFields } from '#/features/settings/use-cases/useSettingsFields';
import { useSettingsSection } from '#/features/settings/use-cases/useSettingsSection';
import { resetConsole } from '#/testing/resetConsole';
import { settingsHarness } from '#/testing/settingsSectionHarness';

afterEach(() => {
  resetConsole();
});

function mounted() {
  const { render } = settingsHarness();
  return render((input) => {
    const save = useSettingsSection(input);
    return { save, fields: useSettingsFields(input.section, save, {}) };
  }, 'sessions');
}

it('draws a control for each field of the section, with the value as read', async () => {
  const { result } = mounted();
  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });
  expect(result.current.used.fields.controls[0]).toMatchObject({
    name: 'sso_session_idle_seconds',
    control: 'number',
    value: 1800,
  });
});

it('edits through the save, and keeps a number that was cleared as it was', async () => {
  const { result } = mounted();
  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });
  act(() => {
    result.current.used.fields.change('sso_session_idle_seconds', 3600);
  });
  expect(result.current.used.save.values.sso_session_idle_seconds).toBe(3600);
  act(() => {
    result.current.used.fields.change('sso_session_idle_seconds', Number.NaN);
  });
  expect(result.current.used.save.values.sso_session_idle_seconds).toBe(3600);
});
