import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { useCursorTrail } from '#/shared/repository/useCursorTrail.ts';
import { parseSearch, stringifySearch } from '#/shared/service/search.ts';
import { Pager } from '#/shared/view/Pager.tsx';

const PAGES = ['', 'b2Zmc2V0LTE.dGFnMQ', 'b2Zmc2V0LTI.dGFnMg'];

function Subjects() {
  const { trail, setTrail } = useCursorTrail();
  const page = trail.length;
  return (
    <>
      <p>{`Showing page ${String(page + 1)}`}</p>
      <Pager
        label="Subjects"
        trail={trail}
        next={PAGES[page + 1] ?? null}
        onTrailChange={setTrail}
      />
    </>
  );
}

function mount(url: string) {
  const root = createRootRoute();
  const subjects = createRoute({
    getParentRoute: () => root,
    path: '/acme/subjects',
    component: Subjects,
  });
  const history = createMemoryHistory({ initialEntries: [url] });
  const router = createRouter({
    routeTree: root.addChildren([subjects]),
    history,
    basepath: '/console',
    parseSearch,
    stringifySearch,
  });
  const view = render(<RouterProvider router={router} />);
  return { router, unmount: view.unmount };
}

it('keeps the visited cursors in the URL, so Previous and Next survive a reload', async () => {
  const user = userEvent.setup();
  const first = mount('/console/acme/subjects?q=grace');
  await screen.findByText('Showing page 1');

  await user.click(screen.getByRole('button', { name: 'Next page' }));
  await user.click(await screen.findByRole('button', { name: 'Next page' }));
  await screen.findByText('Showing page 3');
  const url = first.router.state.location.publicHref;
  expect(url).toBe(
    `/console/acme/subjects?q=grace&after=${PAGES[1] ?? ''}&after=${PAGES[2] ?? ''}`,
  );
  first.unmount();

  mount(url);
  expect(await screen.findByText('Showing page 3')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Previous page' }));
  expect(await screen.findByText('Showing page 2')).toBeVisible();
});

it('starts from the first page when the URL carries a trail it cannot trust', async () => {
  mount('/console/acme/subjects?after=not-a-cursor');
  expect(await screen.findByText('Showing page 1')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
});
