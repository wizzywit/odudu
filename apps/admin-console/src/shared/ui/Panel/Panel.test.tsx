import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { expect, it } from 'vitest';
import { Panel } from '#/shared/ui/Panel';
import { axeInBothThemes } from '#/testing/axeInBothThemes';

const panel = (
  <main>
    <h1>Record</h1>
    <Panel title="Delete">
      <p>Gone for good.</p>
    </Panel>
    <Panel title="Fixed">
      <p>Cannot change.</p>
    </Panel>
  </main>
);

it('is a region named by its heading', () => {
  render(panel);
  const region = screen.getByRole('region', { name: 'Delete' });
  expect(region).toHaveTextContent('Gone for good.');
  expect(screen.getByRole('heading', { level: 2, name: 'Delete' })).toBeVisible();
});

it('names each region by its own heading', () => {
  render(panel);
  expect(screen.getByRole('region', { name: 'Fixed' })).toHaveTextContent('Cannot change.');
});

it('hands its heading to a page that asks for it, and to nobody else', () => {
  const named = createRef<HTMLHeadingElement>();
  render(
    <main>
      <Panel title="Clients" headingRef={named}>
        <p>Body</p>
      </Panel>
      <Panel title="Other">
        <p>Body</p>
      </Panel>
    </main>,
  );
  named.current?.focus();
  expect(screen.getByRole('heading', { name: 'Clients' })).toHaveFocus();
  expect(screen.getByRole('heading', { name: 'Other' })).not.toHaveAttribute('tabindex');
});

it('has no accessibility violations in either theme', async () => {
  expect(await axeInBothThemes(() => panel)).toEqual({ light: [], dark: [] });
});
