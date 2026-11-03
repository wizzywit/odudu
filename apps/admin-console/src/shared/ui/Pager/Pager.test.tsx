import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { MAX_PAGES } from '#/shared/lib/services/cursorTrail';
import { Pager } from '#/shared/ui/Pager/Pager';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

it('is a named navigation that says which page it is on', () => {
  render(<Pager label="Subjects" list={{ trail: ['c-2'], next: 'c-3', setTrail: vi.fn() }} />);
  const nav = screen.getByRole('navigation', { name: 'Pages of subjects' });
  expect(nav).toHaveTextContent('Page 2');
});

it('steps forward by appending the next cursor to the trail', async () => {
  const user = userEvent.setup();
  const onTrailChange = vi.fn();
  render(
    <Pager label="Subjects" list={{ trail: ['c-2'], next: 'c-3', setTrail: onTrailChange }} />,
  );
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  expect(onTrailChange).toHaveBeenCalledWith(['c-2', 'c-3']);
});

it('steps back through the cursors it has visited', async () => {
  const user = userEvent.setup();
  const onTrailChange = vi.fn();
  render(
    <Pager
      label="Subjects"
      list={{ trail: ['c-2', 'c-3'], next: null, setTrail: onTrailChange }}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Previous page' }));
  expect(onTrailChange).toHaveBeenCalledWith(['c-2']);
});

it('cannot go back from the first page or on from the last', () => {
  render(<Pager label="Subjects" list={{ trail: [], next: null, setTrail: vi.fn() }} />);
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: /load more/iu })).toBeNull();
});

it.each([
  ['the page limit', Array.from({ length: MAX_PAGES }, (_, page) => `c${String(page)}.t`)],
  ['the length limit', Array.from({ length: 4 }, () => `${'a'.repeat(1400)}.t`)],
])('stops at %s and says why without claiming a page count', (_, trail) => {
  render(
    <Pager label="Subjects" list={{ trail, next: `${'b'.repeat(1400)}.t`, setTrail: vi.fn() }} />,
  );
  const next = screen.getByRole('button', { name: 'Next page' });
  expect(next).toBeDisabled();
  expect(next).toHaveAccessibleDescription(
    'This is as far as the list can page. Narrow it to see further.',
  );
});

it('loads more in place while there is a next page, and says when it is busy', async () => {
  const user = userEvent.setup();
  const onLoadMore = vi.fn();
  const { rerender } = render(
    <Pager
      label="Subjects"
      list={{ trail: [], next: 'c-2', setTrail: vi.fn(), loadMore: onLoadMore }}
    />,
  );
  expect(screen.getByRole('navigation')).toHaveTextContent('Page 1');
  await user.click(screen.getByRole('button', { name: 'Load more subjects' }));
  expect(onLoadMore).toHaveBeenCalledOnce();
  expect(screen.getByRole('navigation')).not.toHaveTextContent(/Page \d/u);
  rerender(
    <Pager
      label="Subjects"
      list={{ trail: [], next: 'c-2', setTrail: vi.fn(), loadMore: onLoadMore, loadingMore: true }}
    />,
  );
  expect(screen.getByRole('button', { name: 'Loading more subjects…' })).toBeDisabled();
});

it('swaps Load more for the reason once the list cannot load further, and keeps Next', () => {
  render(
    <Pager
      label="Subjects"
      list={{ trail: [], next: 'c-2', setTrail: vi.fn(), loadMore: vi.fn(), loadLimited: true }}
    />,
  );
  expect(screen.queryByRole('button', { name: /load more/iu })).toBeNull();
  expect(
    screen.getByText('This is as far as the list can load. Narrow it to see further.'),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
});

it('offers no Load more on the last page, whatever can be loaded', () => {
  render(
    <Pager
      label="Subjects"
      list={{ trail: ['c-2'], next: null, setTrail: vi.fn(), loadMore: vi.fn() }}
    />,
  );
  expect(screen.queryByRole('button', { name: /load more/iu })).toBeNull();
});

it('offers no jump to a numbered page', () => {
  render(<Pager label="Subjects" list={{ trail: ['c-2'], next: 'c-3', setTrail: vi.fn() }} />);
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Previous', 'Next']);
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <Pager
        label="Subjects"
        list={{ trail: ['c-2'], next: 'c-3', setTrail: vi.fn(), loadMore: vi.fn() }}
      />
    )),
  ).toEqual({ light: [], dark: [] });
});
