import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Conflict } from '#/shared/service/conflict.ts';
import type { SaveStatus } from '#/shared/service/sectionSave.ts';
import { SectionNotice } from '#/shared/view/SectionNotice.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const CONFLICTS: readonly Conflict[] = [
  { field: 'name', label: 'Name', theirs: 'Payments', yours: 'Billing', secret: false },
  { field: 'enabled', label: 'Enabled', theirs: false, yours: true, secret: false },
];

function notice(status: SaveStatus, overrides: Partial<Parameters<typeof SectionNotice>[0]> = {}) {
  return (
    <SectionNotice
      section="General"
      status={status}
      conflicts={status === 'conflict' ? CONFLICTS : []}
      conflictSource="changed"
      message={null}
      busy={false}
      onKeepMine={vi.fn()}
      onTakeTheirs={vi.fn()}
      {...overrides}
    />
  );
}

it('is a live region from the start, empty while there is nothing to say', () => {
  render(notice('idle'));
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});

it('announces conflicts in one line and keeps the comparison out of the announcement', () => {
  render(notice('conflict'));
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent(
    'Name, Enabled in General changed elsewhere since you opened it. Keep yours or take theirs.',
  );
  expect(within(status).queryByRole('table')).toBeNull();
  expect(
    screen.getByRole('table', { name: 'Changed in General since you opened it' }),
  ).toBeVisible();
});

it('says a 412 left the edits untouched, and to save again', () => {
  render(notice('stale'));
  expect(screen.getByRole('status')).toHaveTextContent(
    'General changed elsewhere since you opened it. None of your edits was touched, and they are kept on the new version: save again to apply them.',
  );
});

it('says what refused the save', () => {
  render(notice('refused', { message: 'grace is the last enabled administrator' }));
  expect(screen.getByRole('status')).toHaveTextContent('grace is the last enabled administrator');
});

it('passes axe in both themes', async () => {
  expect(await axeInBothThemes(() => notice('conflict'))).toEqual({ light: [], dark: [] });
  expect(await axeInBothThemes(() => notice('stale'))).toEqual({ light: [], dark: [] });
});

it('keeps its announcement valid markup: a paragraph holding only phrasing', () => {
  render(notice('conflict'));
  expect(screen.getByRole('status').querySelector('div')).toBeNull();
});
