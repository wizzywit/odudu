import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { use, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HIGHLIGHT_LIMIT, type CodeLanguage, type LineIssue } from '#/shared/service/code';
import { CodeField, CodeInsert } from '#/shared/view/CodeField/CodeField';
import css from '#/shared/view/CodeField/CodeField.module.css?raw';
import { ReadOnlyFields } from '#/shared/view/Field';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { stubContainerWidth } from '#/testing/narrowContainer';

function Editor({
  start = '',
  language = 'css',
  issues,
  size,
  onValue,
}: {
  start?: string;
  language?: CodeLanguage;
  issues?: readonly LineIssue[];
  size?: { text: string; over: boolean };
  onValue?: (value: string) => void;
}) {
  const [value, setValue] = useState(start);
  return (
    <>
      <CodeField
        label="Stylesheet"
        description="Your own rules."
        language={language}
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
        {...(issues === undefined ? {} : { issues })}
        {...(size === undefined ? {} : { size })}
      />
      <button type="button">After</button>
    </>
  );
}

const box = () => screen.getByRole('textbox', { name: 'Stylesheet' });

function layer(container: HTMLElement): HTMLElement {
  const found = container.querySelector('pre[aria-hidden="true"]');
  if (!(found instanceof HTMLElement)) throw new Error('no layer');
  return found;
}

describe('CodeField', () => {
  it('is a labelled textarea that reports what is typed', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Editor onValue={onValue} />);
    await user.type(box(), 'a');
    expect(box().tagName).toBe('TEXTAREA');
    expect(onValue).toHaveBeenCalledWith('a');
    expect(box()).toHaveAttribute('wrap', 'off');
  });

  it('draws a coloured copy of the text behind it, hidden from assistive technology', () => {
    const { container } = render(<Editor start={'.a { color: red }\n/* x */'} />);
    const copy = layer(container);
    expect(copy.textContent).toBe('.a { color: red }\n/* x */\n');
    expect(copy.querySelectorAll('span span').length).toBeGreaterThan(2);
    expect(box()).toHaveValue('.a { color: red }\n/* x */');
  });

  it('marks the scroller that holds the numbers and the text, for the caret to be brought into view', () => {
    const { container } = render(<Editor start="a" />);
    const scroller = container.querySelector('[data-code-scroller]');
    expect(scroller).not.toBeNull();
    expect(scroller?.contains(box())).toBe(true);
    expect(scroller?.querySelector('pre')).not.toBeNull();
  });

  it('colours a template with its parts', () => {
    const { container } = render(<Editor language="template" start="<p>{{intro}}</p>" />);
    expect(layer(container).textContent).toBe('<p>{{intro}}</p>\n');
    expect(within(layer(container)).getByText('{{intro}}')).toBeInTheDocument();
  });

  it('numbers the lines, as the text grows', async () => {
    const user = userEvent.setup();
    const { container } = render(<Editor start={'a\nb'} />);
    const gutter = () => container.querySelector('div[aria-hidden="true"]')?.textContent;
    expect(gutter()).toBe('1\n2');
    await user.type(box(), '{Enter}c');
    expect(gutter()).toBe('1\n2\n3');
  });

  it('puts no inline style on anything, as the console policy has no unsafe-inline', () => {
    const { container } = render(
      <Editor start={'a { color: red }'} issues={[{ line: 1, text: 'Not allowed.' }]} />,
    );
    expect(container.querySelector('[style]')).toBeNull();
  });

  it('keeps the layer and the textarea on one set of metrics', () => {
    const source = css.replace(/\/\*[\s\S]*?\*\//gu, '');
    const shared = /\.layer,\s*\.area\s*\{([^}]*)\}/u.exec(source)?.[1] ?? '';
    for (const property of ['grid-area', 'padding', 'border', 'font', 'white-space', 'tab-size']) {
      expect(shared).toContain(`${property}:`);
    }
    expect(source).not.toMatch(/style=|unsafe-inline/u);
  });

  describe('Tab', () => {
    it('indents, and lets go after Escape', async () => {
      const user = userEvent.setup();
      render(<Editor start="a" />);
      await user.click(box());
      await user.keyboard('{Tab}');
      expect(box()).toHaveValue('a  ');
      expect(box()).toHaveFocus();
      await user.keyboard('{Escape}{Tab}');
      expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    });

    it('lets go backwards with Escape then Shift+Tab, and only once', async () => {
      const user = userEvent.setup();
      render(<Editor start="" />);
      await user.click(box());
      await user.keyboard('{Escape}{Shift>}{Tab}{/Shift}');
      expect(box()).not.toHaveFocus();
      await user.click(box());
      await user.keyboard('{Tab}');
      expect(box()).toHaveFocus();
      expect(box()).toHaveValue('  ');
    });

    it('indents each line of a selection and Shift+Tab takes it back', async () => {
      const user = userEvent.setup();
      render(<Editor start={'a\nb'} />);
      await user.click(box());
      await user.keyboard('{Control>}a{/Control}{Tab}');
      expect(box()).toHaveValue('  a\n  b');
      await user.keyboard('{Shift>}{Tab}{/Shift}');
      expect(box()).toHaveValue('a\nb');
    });

    it('says how to leave, where the field is described', () => {
      render(<Editor />);
      expect(box()).toHaveAccessibleDescription(
        /Your own rules\..*Tab indents\. To move on, press Escape then Tab/u,
      );
    });
  });

  describe('a refused line', () => {
    const issues = [
      { line: 2, text: 'The property is not allowed.' },
      { line: 9, text: 'Past the end.' },
    ];

    it('is marked in the gutter and listed, linked to the field', () => {
      const { container } = render(<Editor start={'a {\n  x: 1\n}'} issues={issues} />);
      const marked = container.querySelectorAll('div[aria-hidden="true"] > span');
      expect(marked).toHaveLength(1);
      expect(marked[0]).toHaveTextContent('2');
      expect(screen.getByText('Line 2: The property is not allowed.')).toBeInTheDocument();
      expect(box()).toHaveAccessibleDescription(/Line 2: The property is not allowed\./u);
    });

    it('tints the line in the layer', () => {
      const { container } = render(<Editor start={'a {\n  x: 1\n}'} issues={issues} />);
      const lines = layer(container).children;
      expect(lines[1]).toHaveAttribute('data-marked', 'true');
      expect(lines[0]).not.toHaveAttribute('data-marked');
    });
  });

  it('counts against a limit and says when it is over', () => {
    render(<Editor size={{ text: '3 bytes over the limit of 2 bytes.', over: true }} />);
    expect(screen.getByText('3 bytes over the limit of 2 bytes.')).toHaveAttribute(
      'data-over',
      'true',
    );
  });

  it('shows text too long to colour as typed, with no layer and no numbers, and says so', () => {
    const long = 'x\n'.repeat(HIGHLIGHT_LIMIT);
    const { container } = render(<Editor start={long} />);
    expect(container.querySelector('[data-plain]')).not.toBeNull();
    expect(container.querySelector('pre')).toBeNull();
    expect(container.querySelector('div[aria-hidden="true"]')).toBeNull();
    expect(box()).toHaveValue(long);
    expect(screen.getByText('Colour and line numbers are off for text this long.')).toBeVisible();
  });

  it('draws the layer from the text a textarea holds, whatever its line breaks', () => {
    const { container } = render(<Editor start={'a {\r\n  x: 1\r\n}'} />);
    expect(layer(container).textContent).toBe('a {\n  x: 1\n}\n');
    expect(container.querySelector('div[aria-hidden="true"]')?.textContent).toBe('1\n2\n3');
  });

  describe('read-only', () => {
    it('is read-only where the page is', () => {
      render(
        <ReadOnlyFields when>
          <CodeField label="Stylesheet" language="css" value="a {}" onChange={vi.fn()} />
        </ReadOnlyFields>,
      );
      expect(box()).toHaveAttribute('readonly');
      expect(box()).toHaveValue('a {}');
    });

    it('lets Tab move on and changes nothing', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <ReadOnlyFields when>
          <CodeField label="Stylesheet" language="css" value="a {}" onChange={onChange} />
          <button type="button">After</button>
        </ReadOnlyFields>,
      );
      await user.click(box());
      await user.keyboard('{Tab}');
      expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
      expect(box()).toHaveValue('a {}');
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('an input method', () => {
    it('keeps Tab and Escape while composing, and Tab still indents after', async () => {
      const user = userEvent.setup();
      render(<Editor start="a" />);
      await user.click(box());
      fireEvent.compositionStart(box());
      const tab = createEvent.keyDown(box(), { key: 'Tab' });
      fireEvent(box(), tab);
      expect(tab.defaultPrevented).toBe(false);
      expect(box()).toHaveValue('a');
      const composed = createEvent.keyDown(box(), { key: 'Tab', isComposing: true });
      fireEvent(box(), composed);
      expect(composed.defaultPrevented).toBe(false);
      fireEvent.keyDown(box(), { key: 'Escape' });
      fireEvent.compositionEnd(box());
      await vi.waitFor(() => {
        const after = createEvent.keyDown(box(), { key: 'Tab' });
        fireEvent(box(), after);
        expect(after.defaultPrevented).toBe(true);
      });
      expect(box()).toHaveValue('a  ');
    });
  });

  it('outdents a whitespace-only line to nothing', async () => {
    const user = userEvent.setup();
    render(<Editor start={'a\n  \nb'} />);
    await user.click(box());
    (box() as HTMLTextAreaElement).setSelectionRange(3, 3);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(box()).toHaveValue('a\n\nb');
  });

  it('indents again after a click, though Escape came before it', async () => {
    const user = userEvent.setup();
    render(<Editor start="a" />);
    await user.click(box());
    await user.keyboard('{Escape}');
    await user.click(box());
    await user.keyboard('{Tab}');
    expect(box()).toHaveFocus();
    expect(box()).toHaveValue('a  ');
  });

  it('shows an error under the field', () => {
    render(
      <CodeField
        label="Stylesheet"
        language="css"
        value="a"
        error="The stylesheet was not saved."
        onChange={vi.fn()}
      />,
    );
    expect(box()).toBeInvalid();
    expect(box()).toHaveAccessibleDescription(/The stylesheet was not saved\./u);
  });

  it('passes axe in both themes, with a refused line', async () => {
    expect(
      await axeInBothThemes(() => (
        <Editor
          start={'a {\n  x: 1\n}'}
          issues={[{ line: 2, text: 'The property is not allowed.' }]}
          size={{ text: '12 of 131,072 bytes.', over: false }}
        />
      )),
    ).toEqual({ light: [], dark: [] });
  });
});

describe('undo and redo', () => {
  const area = () => box() as HTMLTextAreaElement;
  const undo = '{Control>}z{/Control}';
  const redo = '{Control>}{Shift>}z{/Shift}{/Control}';

  it('undoes typing a word at a time and redoes it', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.click(box());
    await user.keyboard('ab cd');
    await user.keyboard(undo);
    expect(box()).toHaveValue('ab ');
    await user.keyboard(undo);
    expect(box()).toHaveValue('');
    await user.keyboard(undo);
    expect(box()).toHaveValue('');
    await user.keyboard(redo);
    expect(box()).toHaveValue('ab ');
    await user.keyboard('{Control>}y{/Control}');
    expect(box()).toHaveValue('ab cd');
  });

  it('undoes a Tab indent and puts the caret where it was', async () => {
    const user = userEvent.setup();
    render(<Editor start={'a\nb'} />);
    await user.click(box());
    area().setSelectionRange(3, 3);
    await user.keyboard('{Tab}');
    expect(box()).toHaveValue('a\nb  ');
    await user.keyboard(undo);
    expect(box()).toHaveValue('a\nb');
    expect([area().selectionStart, area().selectionEnd]).toEqual([3, 3]);
    await user.keyboard(redo);
    expect(box()).toHaveValue('a\nb  ');
    expect(area().selectionStart).toBe(5);
  });

  it('undoes an outdent, including of a line that was only space', async () => {
    const user = userEvent.setup();
    render(<Editor start={'a\n  \nb'} />);
    await user.click(box());
    area().setSelectionRange(3, 3);
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(box()).toHaveValue('a\n\nb');
    await user.keyboard(undo);
    expect(box()).toHaveValue('a\n  \nb');
    expect(area().selectionStart).toBe(3);
    await user.keyboard(redo);
    expect(box()).toHaveValue('a\n\nb');
  });

  it('undoes a paste as one step, not with the typing before it', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.click(box());
    await user.keyboard('ab');
    await user.paste('XYZ');
    expect(box()).toHaveValue('abXYZ');
    await user.keyboard(undo);
    expect(box()).toHaveValue('ab');
    await user.keyboard(undo);
    expect(box()).toHaveValue('');
  });

  it('hears historyUndo and historyRedo from the browser too, and keeps the browser out of it', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    await user.click(box());
    await user.keyboard('ab');
    const undoing = new InputEvent('beforeinput', {
      inputType: 'historyUndo',
      bubbles: true,
      cancelable: true,
    });
    box().dispatchEvent(undoing);
    expect(undoing.defaultPrevented).toBe(true);
    expect(box()).toHaveValue('');
    const redoing = new InputEvent('beforeinput', {
      inputType: 'historyRedo',
      bubbles: true,
      cancelable: true,
    });
    box().dispatchEvent(redoing);
    expect(redoing.defaultPrevented).toBe(true);
    expect(box()).toHaveValue('ab');
  });

  it('reports every step through the one onChange typing uses', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    render(<Editor onValue={onValue} />);
    await user.click(box());
    await user.keyboard('a');
    await user.keyboard(undo);
    expect(onValue).toHaveBeenLastCalledWith('');
  });

  it('does nothing in a read-only field', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ReadOnlyFields when>
        <CodeField label="Stylesheet" language="css" value="a {}" onChange={onChange} />
      </ReadOnlyFields>,
    );
    await user.click(box());
    await user.keyboard(undo);
    await user.keyboard(redo);
    expect(box()).toHaveValue('a {}');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('leaves the history alone while an input method composes, and notes one entry after', async () => {
    const user = userEvent.setup();
    render(<Editor start="a" />);
    await user.click(box());
    fireEvent.compositionStart(box());
    const mid = new InputEvent('beforeinput', {
      inputType: 'insertCompositionText',
      data: 'あ',
      bubbles: true,
      cancelable: true,
    });
    box().dispatchEvent(mid);
    await user.keyboard(undo);
    expect(box()).toHaveValue('a');
    fireEvent.change(box(), { target: { value: 'aあ' } });
    fireEvent.compositionEnd(box());
    await vi.waitFor(() => {
      const probe = createEvent.keyDown(box(), { key: 'x' });
      fireEvent(box(), probe);
    });
    await user.keyboard(undo);
    expect(box()).toHaveValue('a');
  });

  it('forgets its history when the text is replaced from outside', async () => {
    const user = userEvent.setup();
    function Outside() {
      const [value, setValue] = useState('');
      return (
        <>
          <CodeField label="Stylesheet" language="css" value={value} onChange={setValue} />
          <button
            type="button"
            onClick={() => {
              setValue('from outside');
            }}
          >
            Replace
          </button>
        </>
      );
    }
    render(<Outside />);
    await user.click(box());
    await user.keyboard('typed');
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    await user.click(box());
    await user.keyboard(undo);
    expect(box()).toHaveValue('from outside');
  });

  describe('tools', () => {
    const undoKeys = '{Control>}z{/Control}';
    function InsertA() {
      const insert = use(CodeInsert);
      return (
        <button
          type="button"
          onClick={() => {
            insert('{{t "a"}}');
          }}
        >
          Insert a
        </button>
      );
    }

    function WithTools({
      start = '',
      readOnly = false,
      disabled = false,
    }: {
      start?: string;
      readOnly?: boolean;
      disabled?: boolean;
    }) {
      const [value, setValue] = useState(start);
      return (
        <ReadOnlyFields when={readOnly}>
          <CodeField
            label="Stylesheet"
            language="template"
            value={value}
            onChange={setValue}
            isDisabled={disabled}
            tools={<InsertA />}
          />
        </ReadOnlyFields>
      );
    }

    it('inserts at the caret, keeps the caret after it and returns focus to the editor', async () => {
      const user = userEvent.setup();
      render(<WithTools start="<h1></h1>" />);
      await user.click(box());
      (box() as HTMLTextAreaElement).setSelectionRange(4, 4);
      await user.click(screen.getByRole('button', { name: 'Insert a' }));
      expect(box()).toHaveValue('<h1>{{t "a"}}</h1>');
      await waitFor(() => {
        expect(box()).toHaveFocus();
      });
      expect((box() as HTMLTextAreaElement).selectionStart).toBe(4 + '{{t "a"}}'.length);
    });

    it('replaces the selection, and an insertion is one undo step', async () => {
      const user = userEvent.setup();
      render(<WithTools start="one two" />);
      await user.click(box());
      (box() as HTMLTextAreaElement).setSelectionRange(0, 3);
      await user.click(screen.getByRole('button', { name: 'Insert a' }));
      expect(box()).toHaveValue('{{t "a"}} two');
      await user.keyboard(undoKeys);
      expect(box()).toHaveValue('one two');
    });

    it('offers nothing to a disabled field', () => {
      render(<WithTools start="x" disabled />);
      expect(screen.queryByRole('button', { name: 'Insert a' })).toBeNull();
    });

    it('does not take focus after it is gone', () => {
      vi.useFakeTimers();
      try {
        const { unmount } = render(<WithTools start="x" />);
        const focus = vi.spyOn(box(), 'focus');
        fireEvent.click(screen.getByRole('button', { name: 'Insert a' }));
        unmount();
        vi.advanceTimersByTime(50);
        expect(focus).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('offers nothing to a read-only field', () => {
      render(<WithTools start="x" readOnly />);
      expect(screen.queryByRole('button', { name: 'Insert a' })).toBeNull();
    });
  });
});

function Narrow(props: Parameters<typeof Editor>[0]) {
  return (
    <div data-narrow-container>
      <Editor {...props} />
    </div>
  );
}

describe('wrapping lines where the editor is stacked', () => {
  stubContainerWidth(400);

  it('wraps its lines to the screen on request, and says whether it does', async () => {
    const user = userEvent.setup();
    const { container } = render(<Narrow start={'a { color: red }'} />);
    const wrap = screen.getByRole('button', { name: 'Wrap lines' });
    expect(wrap).toHaveAttribute('aria-pressed', 'false');
    expect(box()).toHaveAttribute('wrap', 'off');
    await user.click(wrap);
    expect(wrap).toHaveAttribute('aria-pressed', 'true');
    expect(box()).toHaveAttribute('wrap', 'soft');
    expect(container.querySelector('[data-wrap]')).not.toBeNull();
    expect(screen.getByText('Line numbers are hidden while lines wrap.')).toBeVisible();
    await user.click(wrap);
    expect(box()).toHaveAttribute('wrap', 'off');
  });

  it('brings the caret into view after an indent in a long wrapped text', async () => {
    const user = userEvent.setup();
    const offsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
    const clientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-caret') ? 600 : 0;
      },
    });
    Object.defineProperty(Element.prototype, 'clientHeight', {
      configurable: true,
      get(this: Element) {
        return this.hasAttribute('data-code-scroller') || this.tagName === 'TEXTAREA' ? 100 : 0;
      },
    });
    const real = window.getComputedStyle.bind(window);
    const rows = {
      lineHeight: '24px',
      paddingTop: '8px',
      paddingLeft: '12px',
      tabSize: '2',
      getPropertyValue: () => '',
    };
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) =>
      element.tagName === 'TEXTAREA'
        ? (rows as unknown as CSSStyleDeclaration)
        : real(element, pseudo),
    );
    try {
      const { container } = render(<Narrow start={'x '.repeat(400)} />);
      await user.click(screen.getByRole('button', { name: 'Wrap lines' }));
      const scroller = container.querySelector('[data-code-scroller]');
      expect(scroller?.scrollTop).toBe(0);
      await user.click(box());
      await user.keyboard('{Control>}{End}{/Control}{Tab}');
      // The row 25 lines down, a line and a margin of a line below the 100 shown.
      expect(scroller?.scrollTop).toBe(600 + 24 + 24 - 100);
    } finally {
      if (offsetTop !== undefined)
        Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetTop);
      if (clientHeight !== undefined)
        Object.defineProperty(Element.prototype, 'clientHeight', clientHeight);
    }
  });
});

describe('wrapping lines in text past the colouring limit', () => {
  stubContainerWidth(400);

  it('scrolls the textarea itself to the caret, since it is what scrolls', async () => {
    const user = userEvent.setup();
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute('data-caret') ? 600 : 0;
      },
    });
    Object.defineProperty(Element.prototype, 'clientHeight', {
      configurable: true,
      get(this: Element) {
        return this.tagName === 'TEXTAREA' ? 100 : 0;
      },
    });
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) =>
      element.tagName === 'TEXTAREA'
        ? ({
            lineHeight: '24px',
            paddingTop: '8px',
            paddingLeft: '12px',
            tabSize: '2',
            getPropertyValue: () => '',
          } as unknown as CSSStyleDeclaration)
        : real(element, pseudo),
    );
    try {
      const { container } = render(<Narrow start={'x '.repeat(HIGHLIGHT_LIMIT)} />);
      expect(container.querySelector('[data-plain]')).not.toBeNull();
      await user.click(screen.getByRole('button', { name: 'Wrap lines' }));
      await user.click(box());
      await user.keyboard('{Control>}{End}{/Control}{Tab}');
      expect((box() as HTMLTextAreaElement).scrollTop).toBe(600 + 24 + 24 - 100);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, 'offsetTop');
      Reflect.deleteProperty(Element.prototype, 'clientHeight');
    }
  });
});

describe('wrapping lines where the panel is wide', () => {
  stubContainerWidth(1000);

  it('never wraps, whatever the switch was left at, since there is no switch to undo it', async () => {
    const user = userEvent.setup();
    const { container } = render(<Narrow start={'a { color: red }'} />);
    await user.click(screen.getByRole('button', { name: 'Wrap lines' }));
    expect(box()).toHaveAttribute('wrap', 'off');
    expect(container.querySelector('[data-wrap]')).toBeNull();
    expect(screen.queryByText('Line numbers are hidden while lines wrap.')).toBeNull();
  });
});
