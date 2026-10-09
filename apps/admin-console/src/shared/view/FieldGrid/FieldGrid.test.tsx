import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TextField } from '#/shared/view/Field';
import { FieldGrid, GridCell } from '#/shared/view/FieldGrid/FieldGrid.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

describe('FieldGrid', () => {
  it('lays each field in a cell that says how wide it runs', () => {
    render(
      <FieldGrid>
        <GridCell>
          <TextField label="Nickname" value="" onChange={vi.fn()} />
        </GridCell>
        <GridCell span="wide">
          <TextField label="Street" value="" onChange={vi.fn()} />
        </GridCell>
        <GridCell span="full">
          <TextField label="Formatted address" value="" onChange={vi.fn()} />
        </GridCell>
      </FieldGrid>,
    );
    const cells = ['Nickname', 'Street', 'Formatted address'].map((name) =>
      screen.getByRole('textbox', { name }).closest('[data-cell]'),
    );
    expect(cells.map((cell) => cell?.getAttribute('data-span') ?? null)).toEqual([
      null,
      'wide',
      'full',
    ]);
  });

  it('passes axe in both themes', async () => {
    expect(
      await axeInBothThemes(() => (
        <FieldGrid>
          <GridCell span="wide">
            <TextField label="Street" value="" onChange={vi.fn()} />
          </GridCell>
        </FieldGrid>
      )),
    ).toEqual({ light: [], dark: [] });
  });
});
