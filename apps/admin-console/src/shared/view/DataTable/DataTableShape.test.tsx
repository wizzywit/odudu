import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { DataTableShape } from '#/shared/view/DataTable/DataTableShape.tsx';

const shape = (
  <main>
    <DataTableShape
      columns={[{ header: 'Name' }, { header: 'Email', secondary: true }]}
      rows={3}
      cell={<span>·</span>}
    />
  </main>
);

it('draws the real header over the given cell in every body cell', () => {
  render(shape);
  expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
  expect(screen.getAllByText('·')).toHaveLength(6);
});

it('has no accessibility violations in either theme', async () => {
  expect(await axeInBothThemes(() => shape)).toEqual({ light: [], dark: [] });
});
