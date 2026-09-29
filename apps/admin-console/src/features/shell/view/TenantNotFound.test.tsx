import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { TenantNotFound } from '#/features/shell/view/TenantNotFound.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('names the tenant nobody has, and offers the tenant chooser', () => {
  render(<TenantNotFound tenant="no-such" chooseHref="/console/?choose" />);
  expect(screen.getByRole('heading', { level: 1, name: 'Tenant not found' })).toBeVisible();
  expect(screen.getByText('No tenant is named no-such.')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Choose a tenant' })).toHaveAttribute(
    'href',
    '/console/?choose',
  );
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => <TenantNotFound tenant="no-such" chooseHref="/console/?choose" />),
  ).toEqual({ light: [], dark: [] });
});
