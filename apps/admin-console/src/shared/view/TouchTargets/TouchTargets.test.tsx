import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { TouchTargets } from '#/shared/view/TouchTargets';

it('holds what it is given, adding nothing to read', () => {
  render(
    <TouchTargets>
      <button type="button">Save</button>
    </TouchTargets>,
  );
  expect(screen.getByRole('button', { name: 'Save' })).toBeVisible();
  expect(screen.queryAllByRole('region')).toEqual([]);
});
