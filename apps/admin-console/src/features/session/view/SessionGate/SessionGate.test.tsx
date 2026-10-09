import { act, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';
import { json, offline, pending } from '#/testing/fakeTransport.ts';
import {
  consoleAt,
  GRACE,
  renderConsoleAt,
  whoami,
  resetConsole,
} from '#/testing/renderConsole.tsx';

afterEach(() => {
  vi.useRealTimers();
  resetConsole();
});

function later(ms: number) {
  return act(() => vi.advanceTimersByTimeAsync(ms));
}

function onFakeClock(): void {
  vi.useFakeTimers();
}

it('draws the centred card at the bare root, once the read has taken a moment', async () => {
  onFakeClock();
  renderConsoleAt('/console/', { 'GET /console/api/session': pending() });
  await later(199);
  expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  await later(1);
  expect(screen.getByRole('heading', { level: 1, name: 'Odudu console' })).toBeVisible();
  expect(screen.getByRole('status')).toHaveTextContent('Reading your session');
});

it('draws the tenant frame, not the card, for a tenant page', async () => {
  onFakeClock();
  renderConsoleAt('/console/acme/subjects', { 'GET /console/api/session': pending() });
  await later(200);
  expect(screen.getByRole('heading', { level: 1, name: 'Subjects' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Odudu console' })).toBeNull();
  expect(screen.getByRole('region', { name: 'Menu' })).toBeInTheDocument();
  expect(screen.getByRole('main')).toBeInTheDocument();
  expect(document.querySelector('[data-shape="table"]')).not.toBeNull();
});

it('draws the shape of the page being opened', async () => {
  onFakeClock();
  const shape = async (path: string) => {
    const view = renderConsoleAt(path, { 'GET /console/api/session': pending() });
    await later(200);
    const found = document.querySelector('[data-shape]')?.getAttribute('data-shape');
    view.unmount();
    return found;
  };
  expect(await shape('/console/acme')).toBe('panels');
  expect(await shape('/console/acme/subjects/abc')).toBe('record');
  expect(await shape('/console/acme/groups/new')).toBe('form');
});

it('draws nothing visible, and one status line, for a fast read', async () => {
  onFakeClock();
  renderConsoleAt('/console/acme/subjects', { 'GET /console/api/session': pending() });
  await later(199);
  expect(screen.queryByRole('main')).toBeNull();
  expect(screen.getAllByRole('status')).toHaveLength(1);
  expect(screen.getByRole('status')).toHaveTextContent('Reading your session');
  await later(1);
  expect(screen.getAllByRole('status')).toHaveLength(1);
});

it('keeps the one status element through the placeholder, so it is announced in place', async () => {
  onFakeClock();
  renderConsoleAt('/console/acme/subjects', { 'GET /console/api/session': pending() });
  await later(199);
  const line = screen.getByRole('status');
  await later(1);
  expect(screen.getByRole('status')).toBe(line);
  expect(line).toHaveTextContent('Reading your session');
});

it('draws the real shell with no placeholder when the session answers at once', async () => {
  onFakeClock();
  renderConsoleAt('/console/acme', {
    'GET /console/api/session': json(GRACE),
    'GET /console/api/admin/tenants/acme/whoami': whoami([]),
  });
  await later(50);
  expect(document.querySelector('[data-shape="panels"]')).toBeNull();
});

it('says the server could not be reached, and offers to try again', async () => {
  renderConsoleAt('/console/acme', { 'GET /console/api/session': offline() });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The console could not reach the server',
  );
  expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
});

it('renders the page behind it once the session is read', async () => {
  renderConsoleAt('/console/acme', {
    'GET /console/api/session': json(GRACE),
    'GET /console/api/admin/tenants/acme/whoami': whoami([]),
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Overview' })).toBeVisible();
});

it('passes axe in both themes, loading, framed and failed', async () => {
  const loading = () => consoleAt('/console/acme', { 'GET /console/api/session': pending() });
  expect(
    await axeInBothThemes(
      () => loading().element,
      () => screen.findByRole('status'),
    ),
  ).toEqual({ light: [], dark: [] });
  const framed = () =>
    consoleAt('/console/acme/subjects', { 'GET /console/api/session': pending() });
  expect(
    await axeInBothThemes(
      () => framed().element,
      () => screen.findByRole('heading', { level: 1, name: 'Subjects' }),
    ),
  ).toEqual({ light: [], dark: [] });
  const failed = () => consoleAt('/console/acme', { 'GET /console/api/session': offline() });
  expect(
    await axeInBothThemes(
      () => failed().element,
      () => screen.findByRole('alert'),
    ),
  ).toEqual({ light: [], dark: [] });
});
