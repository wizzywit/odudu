import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Owner } from '#/features/roles/view/Owner.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

const TENANT = { client_id: null, client_key: null };
const CLIENT = { client_id: 'c-portal', client_key: 'portal' };
const ADMIN = { client_id: 'c-admin', client_key: 'odudu-admin' };

it('says in words whose role it is', () => {
  render(
    <>
      <Owner role={TENANT} />
      <Owner role={CLIENT} />
      <Owner role={ADMIN} />
    </>,
  );
  expect(screen.getByText('tenant role')).toBeVisible();
  expect(screen.getByText('role of client portal')).toBeVisible();
  expect(screen.getByText('admin capability')).toBeVisible();
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <p>
        <Owner role={TENANT} /> <Owner role={CLIENT} /> <Owner role={ADMIN} />
      </p>
    )),
  ).toEqual({ light: [], dark: [] });
});
