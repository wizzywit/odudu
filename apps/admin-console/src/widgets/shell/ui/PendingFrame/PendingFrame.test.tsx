import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PendingFrame } from '#/widgets/shell/ui/PendingFrame';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('holds the rail and the page, and says once that it is reading', () => {
  render(<PendingFrame tenant="acme" shape="list" title="Subjects" />);
  expect(screen.getByRole('region', { name: 'Menu' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'Subjects' })).toBeVisible();
  expect(screen.getByRole('main')).toBeInTheDocument();
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('Reading your session');
});

it("carries the staff mark with the tenant's name in the rail and the top bar", () => {
  render(<PendingFrame tenant="acme" shape="list" title="Subjects" />);
  expect(screen.getAllByText('odudu · acme')).toHaveLength(2);
  expect(document.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(2);
});

it('draws no heading for a page whose title is its own', () => {
  render(<PendingFrame tenant="acme" shape="record" title={null} />);
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
});

it('passes axe in both themes for every shape', async () => {
  for (const shape of ['overview', 'list', 'record', 'form', 'page'] as const) {
    expect(
      await axeInBothThemes(() => (
        <PendingFrame tenant="acme" shape={shape} title={shape === 'list' ? 'Subjects' : null} />
      )),
    ).toEqual({ light: [], dark: [] });
  }
});
