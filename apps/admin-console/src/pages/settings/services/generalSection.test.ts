import { expect, it } from 'vitest';
import { disableDialog, fixedSettings } from '#/pages/settings/services/generalSection';

it('fixes the enabled switch with its reason, and nothing when there is none', () => {
  expect(fixedSettings('system cannot be disabled')).toEqual({
    enabled: 'system cannot be disabled',
  });
  expect(fixedSettings(null)).toEqual({});
});

it('names the tenant in the dialog title and its confirm label', () => {
  expect(disableDialog('acme', 'Nobody can sign in.')).toEqual({
    title: 'Disable acme?',
    confirmLabel: 'Disable acme',
    consequence: 'Nobody can sign in.',
  });
});
