import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Panel } from '#/features/overview/view/Panel';
import { axeInBothThemes } from '#/testing/axeInBothThemes.ts';

it('is a region named by its heading, with its action beside it', () => {
  render(
    <Panel title="Counts" action={<a href="/somewhere">Everything</a>}>
      <p>Body</p>
    </Panel>,
  );
  const region = screen.getByRole('region', { name: 'Counts' });
  expect(region).toContainElement(screen.getByRole('heading', { level: 2, name: 'Counts' }));
  expect(region).toContainElement(screen.getByRole('link', { name: 'Everything' }));
  expect(region).toHaveTextContent('Body');
});

it('passes axe in both themes', async () => {
  expect(
    await axeInBothThemes(() => (
      <Panel title="Counts">
        <p>Body</p>
      </Panel>
    )),
  ).toEqual({ light: [], dark: [] });
});
