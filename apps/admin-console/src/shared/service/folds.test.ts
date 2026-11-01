import { expect, it } from 'vitest';
import { foldToggled } from '#/shared/service/folds';

it('opens a closed fold and closes an open one, leaving the others', () => {
  const none = new Set<string>();
  const light = foldToggled(none, 'light');
  expect([...light]).toEqual(['light']);
  expect([...foldToggled(light, 'dark')]).toEqual(['light', 'dark']);
  expect([...foldToggled(light, 'light')]).toEqual([]);
  expect([...none]).toEqual([]);
});
