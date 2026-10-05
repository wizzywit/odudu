import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ButtonLink } from '#/shared/view/ButtonLink/ButtonLink.tsx';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('is a link with its href, named by its text', () => {
  render(<ButtonLink href="/console/system/new-tenant">Create a tenant</ButtonLink>);
  expect(screen.getByRole('link', { name: 'Create a tenant' })).toHaveAttribute(
    'href',
    '/console/system/new-tenant',
  );
});

it('passes axe in both themes in every variant', async () => {
  expect(
    await axeInBothThemes(() => (
      <>
        <ButtonLink href="/a" variant="primary">
          Primary
        </ButtonLink>
        <ButtonLink href="/b">Secondary</ButtonLink>
        <ButtonLink href="/c" variant="quiet" size="small">
          Quiet
        </ButtonLink>
      </>
    )),
  ).toEqual({ light: [], dark: [] });
});
