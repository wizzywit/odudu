import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PageHeader } from '#/shared/view/PageHeader.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('titles the page and carries its kind, description and actions', () => {
  render(
    <PageHeader
      kicker="Client"
      title="Billing portal"
      description="A confidential client."
      actions={<button type="button">Disable</button>}
    />,
  );
  const heading = screen.getByRole('heading', { level: 1, name: 'Billing portal' });
  const header = heading.closest('header');
  expect(header).toHaveTextContent('Client');
  expect(header).toHaveTextContent('A confidential client.');
  expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => <PageHeader kicker="Client" title="Billing portal" />),
  ).toEqual({ light: [], dark: [] });
});
