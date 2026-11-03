import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { RootBoundary } from '#/widgets/failure/ui/RootBoundary';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const broken = vi.hoisted(() => ({ root: false }));

vi.mock('#/widgets/failure/ui/RootFailure', async (importOriginal) => {
  const actual = await importOriginal<{ RootFailure: (props: object) => unknown }>();
  return {
    RootFailure: (props: object) => {
      if (broken.root) throw new Error('the failure screen failed');
      return actual.RootFailure(props);
    },
  };
});

afterEach(() => {
  broken.root = false;
  vi.restoreAllMocks();
});

function Throws({ error }: { error: unknown }): ReactNode {
  throw error;
}

it('shows what it wraps while nothing has failed, and reads no route', () => {
  const route = vi.fn(() => '/');
  render(
    <RootBoundary route={route} record={vi.fn()}>
      <p>the console</p>
    </RootBoundary>,
  );
  expect(screen.getByText('the console')).toBeVisible();
  expect(route).not.toHaveBeenCalled();
});

it('shows the standalone fallback for anything thrown, a non-error included', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(
    <RootBoundary route={() => '/$tenant'} record={vi.fn()}>
      <Throws error="a thrown string" />
    </RootBoundary>,
  );
  expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  expect(screen.getByRole('region', { name: 'error details' })).toHaveTextContent('Page: /$tenant');
});

it('shows it for a thrown undefined too, which is still a failure', () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(
    <RootBoundary route={() => '/'} record={vi.fn()}>
      <Throws error={undefined} />
    </RootBoundary>,
  );
  expect(screen.getByRole('alert')).toBeVisible();
});

it('stands a minimal page in when the failure screen fails too, after logging the first error', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const first = new Error('the original');
  const record = vi.fn<(error: unknown) => { id: string; route: string; time: string }>(() => ({
    id: 'ABCD2345',
    route: '/',
    time: 't',
  }));
  broken.root = true;
  render(
    <RootBoundary route={() => '/'} record={record}>
      <Throws error={first} />
    </RootBoundary>,
  );
  expect(await screen.findByText('Error ID: ABCD2345')).toBeVisible();
  expect(record.mock.calls[0]?.[0]).toBe(first);
});

// React error boundaries see render and effect errors only. A failure in an
// event handler is reported by the browser and changes nothing on screen.
it('does not catch an error thrown from an event handler', async () => {
  const user = userEvent.setup();
  const reported: string[] = [];
  const swallow = (event: ErrorEvent): void => {
    reported.push(event.message);
    event.preventDefault();
  };
  window.addEventListener('error', swallow);
  render(
    <RootBoundary route={() => '/'} record={vi.fn()}>
      <button
        type="button"
        onClick={() => {
          throw new Error('handler failed');
        }}
      >
        press
      </button>
    </RootBoundary>,
  );
  await user.click(screen.getByRole('button', { name: 'press' }));
  window.removeEventListener('error', swallow);
  expect(screen.getByRole('button', { name: 'press' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull();
  expect(reported.join()).toContain('handler failed');
});

it('passes axe in both themes', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(
    await axeInBothThemes(() => (
      <RootBoundary route={() => '/'} record={vi.fn()}>
        <Throws error={new Error('x')} />
      </RootBoundary>
    )),
  ).toEqual({ light: [], dark: [] });
});
