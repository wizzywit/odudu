import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { expect, it } from 'vitest';
import { App } from '#/app/App.tsx';
import { createConsoleRouter } from '#/app/router.tsx';

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
