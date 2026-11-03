import { act, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { usePasswordNote } from '#/pages/settings/use-cases/usePasswordNote';
import { useSettingsSection } from '#/pages/settings/use-cases/useSettingsSection';
import { resetConsole } from '#/testing/resetConsole';
import { settingsAnswer, ST } from '#/testing/settingsFixtures';
import { settingsHarness } from '#/testing/settingsSectionHarness';

afterEach(() => {
  resetConsole();
});

async function noteFor(minLength: number, saved: Record<string, unknown> = {}) {
  const { render } = settingsHarness({ [`GET ${ST}`]: settingsAnswer(saved) });
  const { result } = render((input) => {
    const save = useSettingsSection(input);
    return { save, note: usePasswordNote(save, input.data) };
  }, 'password');
  await waitFor(() => {
    expect(result.current.ready).toBe(true);
  });
  act(() => {
    result.current.used.save.edit('password_min_length', minLength);
  });
  return result.current.used.note;
}

it('warns about a minimum being edited under fifteen, from the second-factor setting as saved', async () => {
  expect((await noteFor(10))?.tone).toBe('warning');
});

it('says a short minimum is enough when the saved setting asks for a second factor', async () => {
  expect((await noteFor(10, { otp_required: true }))?.text).toBe(
    'Every sign-in needs a second factor, so this minimum is enough.',
  );
});

it('says nothing about fifteen or more', async () => {
  expect(await noteFor(15)).toBeNull();
});
