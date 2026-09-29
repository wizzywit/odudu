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

it('leads with a breadcrumb above the title, and puts the status beside it', () => {
  render(
    <PageHeader
      breadcrumb={[{ label: 'Tenants', href: '/console/system/tenants' }, { label: 'acme' }]}
      title="acme"
      status={<span>enabled</span>}
    />,
  );
  const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
  const heading = screen.getByRole('heading', { level: 1, name: 'acme' });
  expect(nav.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(heading.closest('header')).toContainElement(nav);
  expect(heading.parentElement).toHaveTextContent('acmeenabled');
});

it('draws no breadcrumb when none is given', () => {
  render(<PageHeader kicker="System" title="Tenants" />);
  expect(screen.queryByRole('navigation')).toBeNull();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <PageHeader
        breadcrumb={[{ label: 'Clients', href: '/console/acme/clients' }, { label: 'Billing' }]}
        title="Billing portal"
        status={<span>enabled</span>}
      />
    )),
  ).toEqual({ light: [], dark: [] });
});
