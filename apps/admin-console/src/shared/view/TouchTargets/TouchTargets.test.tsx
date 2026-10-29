import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { TouchTargets } from '#/shared/view/TouchTargets';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const page = (
  <TouchTargets>
    <button type="button">Save</button>
  </TouchTargets>
);

it('holds what it is given, adding nothing to read', () => {
  render(page);
  expect(screen.getByRole('button', { name: 'Save' })).toBeVisible();
  expect(screen.queryAllByRole('region')).toEqual([]);
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => page)).toEqual({ light: [], dark: [] });
});
