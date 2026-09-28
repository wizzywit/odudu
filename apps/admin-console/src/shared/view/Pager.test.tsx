import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { MAX_PAGES } from '#/shared/service/cursorTrail.ts';
import { Pager } from '#/shared/view/Pager.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('is a named navigation that says which page it is on', () => {
  render(<Pager label="Subjects" trail={['c-2']} next="c-3" onTrailChange={vi.fn()} />);
  const nav = screen.getByRole('navigation', { name: 'Pages of subjects' });
  expect(nav).toHaveTextContent('Page 2');
});

it('steps forward by appending the next cursor to the trail', async () => {
  const user = userEvent.setup();
  const onTrailChange = vi.fn();
  render(<Pager label="Subjects" trail={['c-2']} next="c-3" onTrailChange={onTrailChange} />);
  await user.click(screen.getByRole('button', { name: 'Next page' }));
  expect(onTrailChange).toHaveBeenCalledWith(['c-2', 'c-3']);
});

it('steps back through the cursors it has visited', async () => {
  const user = userEvent.setup();
  const onTrailChange = vi.fn();
  render(
    <Pager label="Subjects" trail={['c-2', 'c-3']} next={null} onTrailChange={onTrailChange} />,
  );
  await user.click(screen.getByRole('button', { name: 'Previous page' }));
  expect(onTrailChange).toHaveBeenCalledWith(['c-2']);
});

it('cannot go back from the first page or on from the last', () => {
  render(<Pager label="Subjects" trail={[]} next={null} onTrailChange={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: /load more/iu })).toBeNull();
});

it('stops at the page limit and says why, since there is no jump to a page', () => {
  const full = Array.from({ length: MAX_PAGES }, (_, page) => `c${String(page)}.t`);
  render(<Pager label="Subjects" trail={full} next="more.t" onTrailChange={vi.fn()} />);
  const next = screen.getByRole('button', { name: 'Next page' });
  expect(next).toBeDisabled();
  expect(next).toHaveAccessibleDescription(
    `Paged as far as ${String(MAX_PAGES)} pages. Narrow the list to see further.`,
  );
});

it('loads more in place while there is a next page, and says when it is busy', async () => {
  const user = userEvent.setup();
  const onLoadMore = vi.fn();
  const { rerender } = render(
    <Pager
      label="Subjects"
      trail={[]}
      next="c-2"
      onTrailChange={vi.fn()}
      onLoadMore={onLoadMore}
    />,
  );
  expect(screen.getByRole('navigation')).toHaveTextContent('Page 1');
  await user.click(screen.getByRole('button', { name: 'Load more subjects' }));
  expect(onLoadMore).toHaveBeenCalledOnce();
  expect(screen.getByRole('navigation')).not.toHaveTextContent(/Page \d/u);
  rerender(
    <Pager
      label="Subjects"
      trail={[]}
      next="c-2"
      onTrailChange={vi.fn()}
      onLoadMore={onLoadMore}
      loadingMore
    />,
  );
  expect(screen.getByRole('button', { name: 'Loading more subjects…' })).toBeDisabled();
});

it('offers no jump to a numbered page', () => {
  render(<Pager label="Subjects" trail={['c-2']} next="c-3" onTrailChange={vi.fn()} />);
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Previous', 'Next']);
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <Pager
        label="Subjects"
        trail={['c-2']}
        next="c-3"
        onTrailChange={vi.fn()}
        onLoadMore={vi.fn()}
      />
    )),
  ).toEqual({ light: [], dark: [] });
});
