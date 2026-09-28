import { createMemoryHistory } from '@tanstack/react-router';
import { act, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, expect, it } from 'vitest';
import { App } from '#/app/App.tsx';
import { createConsoleRouter } from '#/app/router.tsx';
import { useToasts } from '#/shared/repository/useToasts.ts';

afterEach(() => {
  useToasts.setState({ toasts: [] });
});

function renderAt(path: string): void {
  const router = createConsoleRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<App router={router} />);
}

async function violations(): Promise<string[]> {
  const result = await axe.run(document.body);
  return result.violations.map((v) => `${v.id}: ${v.help}`);
}

it('renders the shell under the router at the console root', async () => {
  renderAt('/console/');
  expect(await screen.findByRole('heading', { level: 1, name: 'Odudu console' })).toBeVisible();
  expect(screen.getByRole('main')).toBeInTheDocument();
  expect(await violations()).toEqual([]);
});

it('renders the not-found page inside the shell for an unknown path', async () => {
  renderAt('/console/no-such-page');
  expect(await screen.findByRole('heading', { level: 2, name: 'Page not found' })).toBeVisible();
  expect(screen.getByRole('heading', { level: 1, name: 'Odudu console' })).toBeVisible();
  expect(await violations()).toEqual([]);
});

it('shows the queued toasts and dismisses them from the queue', async () => {
  renderAt('/console/');
  await screen.findByRole('heading', { level: 1, name: 'Odudu console' });
  act(() => {
    useToasts.getState().push({ tone: 'error', message: 'The server could not be reached' });
  });
  const region = screen.getByRole('region', { name: 'Notifications' });
  expect(within(region).getByText('The server could not be reached')).toBeVisible();
  act(() => {
    within(region)
      .getByRole('button', { name: /^Dismiss/u })
      .click();
  });
  expect(useToasts.getState().toasts).toEqual([]);
  expect(within(region).queryByText('The server could not be reached')).toBeNull();
});
