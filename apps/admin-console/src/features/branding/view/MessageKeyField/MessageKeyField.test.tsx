import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageEntry } from '#/features/branding/service';
import { InsertMessage, MessageKeyField } from '#/features/branding/view/MessageKeyField';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { CodeField } from '#/shared/view/CodeField';
import type { Read } from '#/shared/service/read';

const ENTRIES: MessageEntry[] = [
  { key: 'login.title', text: 'Sign in' },
  { key: 'login.submit', text: 'Continue' },
  { key: 'error.title', text: 'Something went wrong' },
];

const ready: Read<MessageEntry[]> = { status: 'ready', data: ENTRIES };

function Override({ keys = ready }: { keys?: Read<MessageEntry[]> }) {
  const [value, setValue] = useState('');
  return (
    <>
      <MessageKeyField
        keys={keys}
        label="Message key"
        description="The key to replace."
        value={value}
        onChange={setValue}
        custom
        mono
      />
      <output aria-label="Key">{value}</output>
    </>
  );
}

function Editor({ keys = ready, start = '' }: { keys?: Read<MessageEntry[]>; start?: string }) {
  const [text, setText] = useState(start);
  return (
    <CodeField
      label="Template"
      language="template"
      value={text}
      onChange={setText}
      tools={<InsertMessage keys={keys} />}
    />
  );
}

describe('MessageKeyField', () => {
  it('lists the keys with their text, narrowed by typing either', async () => {
    const user = userEvent.setup();
    render(<Override />);
    await user.click(screen.getByRole('button', { name: /^Show Message key options/u }));
    expect(await screen.findAllByRole('option')).toHaveLength(3);
    await user.type(screen.getByRole('combobox', { name: 'Message key' }), 'went wrong');
    const found = await screen.findAllByRole('option');
    expect(found.map((o) => o.textContent)).toEqual(['error.titleSomething went wrong']);
  });

  it('chooses a key by keyboard alone', async () => {
    const user = userEvent.setup();
    render(<Override />);
    await user.tab();
    await user.keyboard('submit');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByLabelText('Key')).toHaveTextContent('login.submit');
  });

  it('keeps a key it does not list, for the server to refuse', async () => {
    const user = userEvent.setup();
    render(<Override />);
    await user.type(screen.getByRole('combobox', { name: 'Message key' }), 'no.such.key');
    expect(screen.getByLabelText('Key')).toHaveTextContent('no.such.key');
  });

  it('draws at most fifty keys of a long list', async () => {
    const user = userEvent.setup();
    const many: Read<MessageEntry[]> = {
      status: 'ready',
      data: Array.from({ length: 400 }, (_, n) => ({ key: `k.n${String(n)}`, text: 'text' })),
    };
    render(<Override keys={many} />);
    await user.click(screen.getByRole('button', { name: /^Show Message key options/u }));
    expect(await screen.findAllByRole('option')).toHaveLength(50);
  });

  it('says the list is loading and still takes typed text', async () => {
    const user = userEvent.setup();
    render(<Override keys={{ status: 'loading' }} />);
    expect(screen.getByRole('combobox', { name: 'Message key' })).toHaveAccessibleDescription(
      /Loading the list of messages\./u,
    );
    await user.type(screen.getByRole('combobox', { name: 'Message key' }), 'login.title');
    expect(screen.getByLabelText('Key')).toHaveTextContent('login.title');
  });

  it('says the list could not be loaded, offers another try, and still takes typed text', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<Override keys={{ status: 'failed', refused: false, retry }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The list of messages could not be loaded.',
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
    await user.type(screen.getByRole('combobox', { name: 'Message key' }), 'a.b');
    expect(screen.getByLabelText('Key')).toHaveTextContent('a.b');
  });

  it('has nothing axe can find, open or closed, in either theme', async () => {
    const user = userEvent.setup();
    expect(
      await axeInBothThemes(
        () => <Override />,
        async () => {
          await user.click(screen.getByRole('button', { name: /^Show Message key options/u }));
          await screen.findByRole('listbox');
        },
        { disable: ['aria-hidden-focus'] },
      ),
    ).toEqual({ light: [], dark: [] });
  });
});

describe('InsertMessage', () => {
  it('types a reference to the chosen message at the caret and returns to the editor', async () => {
    const user = userEvent.setup();
    render(<Editor start="<h1></h1>" />);
    const box = screen.getByRole('textbox', { name: 'Template' });
    await user.click(box);
    (box as HTMLTextAreaElement).setSelectionRange(4, 4);
    await user.type(screen.getByRole('combobox', { name: 'Insert a message' }), 'login.ti');
    await user.click(await screen.findByRole('option', { name: /login\.title/u }));
    expect(box).toHaveValue('<h1>{{t "login.title"}}</h1>');
    await waitFor(() => {
      expect(box).toHaveFocus();
    });
  });

  it('inserts again after the field was emptied, whatever was chosen before', async () => {
    const user = userEvent.setup();
    render(<Editor />);
    const box = screen.getByRole('textbox', { name: 'Template' });
    for (const key of ['login.title', 'login.title']) {
      await user.type(screen.getByRole('combobox', { name: 'Insert a message' }), key);
      await user.click(await screen.findByRole('option', { name: new RegExp(key, 'u') }));
    }
    expect(box).toHaveValue('{{t "login.title"}}{{t "login.title"}}');
  });

  it('is unavailable until the list is read', () => {
    render(<Editor keys={{ status: 'loading' }} />);
    expect(screen.getByRole('combobox', { name: 'Insert a message' })).toBeDisabled();
  });

  it('has nothing axe can find in either theme', async () => {
    expect(await axeInBothThemes(() => <Editor />)).toEqual({ light: [], dark: [] });
  });
});
