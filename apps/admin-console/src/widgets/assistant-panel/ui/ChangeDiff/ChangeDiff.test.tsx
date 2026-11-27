import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { diffRows } from '#/widgets/assistant-panel/services/approval';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import { ChangeDiff } from '#/widgets/assistant-panel/ui/ChangeDiff';

const ROWS = diffRows(
  { description: 'Old text', gone: 'x', same: 's' },
  { description: 'New text', added: 'y', same: 's' },
);

it('writes what each field is now and what it becomes, and says in words how it changes', () => {
  render(<ChangeDiff rows={ROWS} creating={false} words={PANEL_WORDING} />);
  const list = screen.getByRole('list', { name: 'Change' });
  const rows = within(list).getAllByRole('listitem');
  expect(rows).toHaveLength(4);
  expect(rows[0]).toHaveTextContent('Description');
  expect(rows[0]).toHaveTextContent('changed');
  expect(rows[0]).toHaveTextContent('Old text');
  expect(rows[0]).toHaveTextContent('New text');
  expect(rows[1]).toHaveTextContent('added');
  expect(rows[2]).toHaveTextContent('unchanged');
  expect(rows[3]).toHaveTextContent('removed');
});

it('says a target that does not exist yet has no earlier state', () => {
  render(
    <ChangeDiff rows={diffRows(null, { name: 'ops' })} creating={true} words={PANEL_WORDING} />,
  );
  expect(screen.getByText('Does not exist yet')).toBeInTheDocument();
  expect(screen.getByText('ops')).toBeInTheDocument();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => <ChangeDiff rows={ROWS} creating={false} words={PANEL_WORDING} />),
  ).toEqual({ light: [], dark: [] });
});
