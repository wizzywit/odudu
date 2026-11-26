import { ASSISTANT_SETTING_DEFAULTS, assistantSettingsSchema } from '@odudu/contracts/admin';
import { expect, it } from 'vitest';
import { ASSISTANT_SECTION } from '#/pages/settings/services/assistantSection';
import { assistantRequest } from '#/pages/settings/services/assistantValues';
import { settingEntries } from '#/pages/settings/services/values';

it('sends back every setting a section read, unchanged', () => {
  const values = Object.fromEntries(
    settingEntries(ASSISTANT_SECTION.fields, ASSISTANT_SETTING_DEFAULTS).map((entry) => [
      entry.name,
      entry.value,
    ]),
  );
  expect(assistantRequest(values)).toEqual(ASSISTANT_SETTING_DEFAULTS);
});

it('sends what was edited and reads a mode it does not know as Ask', () => {
  const edited = assistantRequest({
    ...ASSISTANT_SETTING_DEFAULTS,
    assistant_default_mode: 'act',
    assistant_max_concurrent: 2,
  });
  expect(edited).toMatchObject({ assistant_default_mode: 'act', assistant_max_concurrent: 2 });
  expect(assistantRequest({ assistant_default_mode: 'sometimes' })).toMatchObject({
    assistant_default_mode: 'ask',
  });
});

it('draws a field for every setting the server holds, and no other', () => {
  expect(ASSISTANT_SECTION.fields.map((field) => field.name).sort()).toEqual(
    Object.keys(assistantSettingsSchema.shape).sort(),
  );
});

it('says each default as the server holds it', () => {
  const said = (name: string): string =>
    ASSISTANT_SECTION.fields.find((field) => field.name === name)?.description ?? '';
  expect(said('assistant_enabled')).toContain('Default: on.');
  expect(said('assistant_default_mode')).toContain('Default: Ask.');
  expect(said('assistant_mask_emails')).toContain('Default: off.');
  expect(said('assistant_auditor_visible')).toContain('Default: on.');
  expect(said('assistant_trace_retention_days')).toContain('Default: 30 days.');
  expect(said('assistant_monthly_tokens_standard')).toContain('Default: 5,000,000 tokens.');
  expect(said('assistant_max_steps_per_turn')).toContain('Default: 20 steps.');
});
