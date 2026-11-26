import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { splitBlocks } from '#/widgets/assistant-panel/services/blocks';
import { MessageText as Text } from '#/widgets/assistant-panel/ui/MessageText';

function MessageText({ text }: { text: string }) {
  return <Text {...splitBlocks(text)} tableLabel="Table" />;
}

it('draws emphasis, lists and code as the elements they are', () => {
  const { container } = render(
    <MessageText text={'A **bold** word and `code`.\n\n- one\n- two\n\n```\nlet x = 1;\n```'} />,
  );
  expect(container.querySelector('strong')?.textContent).toBe('bold');
  expect(within(container).getAllByRole('listitem')).toHaveLength(2);
  expect(container.querySelector('pre code')?.textContent).toBe('let x = 1;');
});

it('keeps a link to a console page, and shows any other address as the text it is', () => {
  render(
    <MessageText text="See [the client](/console/acme/clients/c1) or [the site](https://example.com/x)." />,
  );
  expect(screen.getByRole('link', { name: 'the client' })).toHaveAttribute(
    'href',
    '/console/acme/clients/c1',
  );
  expect(screen.queryByRole('link', { name: /the site/u })).not.toBeInTheDocument();
  expect(screen.getByText(/the site/u).textContent).toContain('https://example.com/x');
});

it('never draws an image, a script or markup the answer carried', () => {
  const { container } = render(
    <MessageText
      text={'![x](https://evil.test/a.png) <img src=x onerror=alert(1)> <script>alert(1)</script>'}
    />,
  );
  expect(container.querySelector('img, script')).toBeNull();
  expect(container.textContent).toContain('<script>alert(1)</script>');
});

it('draws an answer that is still being written, including a fence not yet closed', () => {
  const { container } = render(<MessageText text={'Done so far.\n\n```\nopen'} />);
  expect(container.querySelector('pre code')?.textContent).toBe('open');
  expect(screen.getByText('Done so far.')).toBeInTheDocument();
});

it('draws nothing for no text', () => {
  const { container } = render(<MessageText text="" />);
  expect(container.textContent).toBe('');
});

it('passes axe in both themes with every kind of node drawn', async () => {
  expect(
    await axeInBothThemes(() => (
      <MessageText
        text={
          'A **bold** and *slanted* word, `code` and [a page](/console/acme/roles).\n\n- one\n\n1. two\n\n```\nblock\n```'
        }
      />
    )),
  ).toEqual({ light: [], dark: [] });
});

const TABLE = '| Name | Kind |\n|---|---|\n| Web | `public` |\n| Api | **secret** |';

it('draws a pipe table as a table that scrolls inside the message', () => {
  render(<MessageText text={`Two clients:\n\n${TABLE}`} />);
  const table = screen.getByRole('table');
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent),
  ).toEqual(['Name', 'Kind']);
  expect(within(table).getAllByRole('columnheader')[0]).toHaveAttribute('scope', 'col');
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(within(table).getByText('public').tagName).toBe('CODE');
  expect(within(table).getByText('secret').tagName).toBe('STRONG');
  expect(table.querySelector('caption')).toBeNull();
  const region = screen.getByRole('region', { name: 'Table' });
  expect(region).toHaveAttribute('tabindex', '0');
  expect(region).toContainElement(table);
});

it('keeps a table that is still being written in one piece', () => {
  render(<MessageText text={'| a | b |\n|---|---|\n| 1 | 2 |'} />);
  expect(screen.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['1', '2']);
});

it('draws no markup a cell carried', () => {
  const { container } = render(
    <MessageText
      text={'| a |\n|---|\n| <img src=x onerror=alert(1)> |\n| ![i](https://e.test/i.png) |'}
    />,
  );
  expect(container.querySelector('img, script')).toBeNull();
  expect(screen.getAllByRole('cell')[0]).toHaveTextContent('<img src=x onerror=alert(1)>');
});

it('passes axe in both themes with a table drawn', async () => {
  expect(await axeInBothThemes(() => <MessageText text={TABLE} />)).toEqual({
    light: [],
    dark: [],
  });
});
