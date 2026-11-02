import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { MappedRole } from '#/shared/services/mappedRoles';
import { MappedRoles } from '#/shared/ui/MappedRoles';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const MAPPED: readonly MappedRole[] = [
  { id: 'r1', name: 'auditor', client_id: null, client_key: null, description: 'Reads the trail' },
  { id: 'r2', name: 'reader', client_id: 'c1', client_key: 'portal', description: null },
  { id: 'r3', name: 'helper', client_id: null, client_key: null, description: '' },
];

it('lists each role by name, told apart by whose it is, with its description when it has one', () => {
  render(<MappedRoles name="invoices" mapped={MAPPED} />);
  const [auditor, reader, helper] = within(
    screen.getByRole('list', { name: 'Carried by invoices' }),
  ).getAllByRole('listitem');
  expect(auditor).toHaveTextContent('auditor');
  expect(auditor).toHaveTextContent('Reads the trail');
  expect(reader).toHaveTextContent('reader');
  expect(reader).toHaveTextContent(/portal/u);
  expect(helper).toHaveTextContent(/^helper/u);
  expect(helper?.children).toHaveLength(reader?.children.length ?? 0);
});

it('says so when it carries none', () => {
  render(<MappedRoles name="invoices" mapped={[]} />);
  expect(screen.getByText('invoices carries no role.')).toBeVisible();
  expect(screen.queryByRole('list')).toBeNull();
});

it('says what it was told to when it carries none', () => {
  render(<MappedRoles name="invoices" mapped={[]} empty="Nothing mapped here." />);
  expect(screen.getByText('Nothing mapped here.')).toBeVisible();
  expect(screen.queryByText('invoices carries no role.')).toBeNull();
});

it('has no accessibility violations in either theme', async () => {
  expect(await axeInBothThemes(() => <MappedRoles name="invoices" mapped={MAPPED} />)).toEqual({
    light: [],
    dark: [],
  });
});
