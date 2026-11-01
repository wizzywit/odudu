import { expect, it } from 'vitest';
import { anySaving, savingKey, savingToggled } from '#/shared/service/savingSections';

it('adds and removes a section, and says nothing changed when nothing did', () => {
  const key = savingKey('acme', 'theme/tenant', 'colours');
  const none = new Set<string>();
  const one = savingToggled(none, key, true);
  expect([...(one ?? [])]).toEqual([key]);
  expect(savingToggled(one ?? none, key, true)).toBeNull();
  expect([...(savingToggled(one ?? none, key, false) ?? [])]).toEqual([]);
  expect(savingToggled(none, key, false)).toBeNull();
});

it('reads a record as saving while any of its sections is, and no other record', () => {
  const saving = new Set([savingKey('acme', 'theme/tenant', 'images')]);
  expect(anySaving(saving, 'acme', 'theme/tenant')).toBe(true);
  expect(anySaving(saving, 'acme', 'theme/client/x')).toBe(false);
  expect(anySaving(saving, 'other', 'theme/tenant')).toBe(false);
});
