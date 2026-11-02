import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { useCursorTrail } from '#/shared/repository/useCursorTrail';
import { Pager } from '#/shared/ui/Pager';
import { mountAtRoute } from '#/testing/mountAtRoute';

const PAGES = ['', 'b2Zmc2V0LTE.dGFnMQ', 'b2Zmc2V0LTI.dGFnMg'];

function Subjects() {
  const { trail, setTrail } = useCursorTrail();
  const page = trail.length;
  return (
    <>
      <p>{`Showing page ${String(page + 1)}`}</p>
      <Pager label="Subjects" list={{ trail, next: PAGES[page + 1] ?? null, setTrail }} />
    </>
  );
}

function mount(url: string) {
  return mountAtRoute(url, '/acme/subjects', Subjects, { basepath: '/console' });
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
