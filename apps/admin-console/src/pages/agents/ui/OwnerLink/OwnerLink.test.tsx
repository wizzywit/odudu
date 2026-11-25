import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OwnerLink } from '#/pages/agents/ui/OwnerLink';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const props = {
  id: '0197a3b1-aaaa',
  name: 'ada',
  linkLabel: 'Open the owner ada',
  copyLabel: 'owner id',
};

it('links the name to the record where there is one, and names the id beside it to copy', () => {
  render(<OwnerLink {...props} href="/console/acme/subjects/s1" />);
  expect(screen.getByRole('link', { name: 'Open the owner ada' })).toHaveAttribute(
    'href',
    '/console/acme/subjects/s1',
  );
  expect(screen.getByRole('button', { name: /owner id/u })).toBeVisible();
});

it('is the name alone, with no link, where the caller may not read the record', () => {
  render(<OwnerLink {...props} href={undefined} />);
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByText('ada')).toBeVisible();
});

it('shows the id to copy alone, and no name, for an owner the server names no username for', () => {
  render(<OwnerLink {...props} name={null} href="/console/acme/subjects/s1" />);
  expect(screen.queryByRole('link')).toBeNull();
  expect(screen.getByRole('button', { name: /owner id/u })).toBeVisible();
  expect(screen.queryByText('ada')).toBeNull();
});

it('has no accessibility violations in either theme', async () => {
  expect(
    await axeInBothThemes(() => <OwnerLink {...props} href="/console/acme/subjects/s1" />),
  ).toEqual({ light: [], dark: [] });
});
