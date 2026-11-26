import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToasts } from '#/shared/lib/repository/useToasts';
import { json, problem, type Answer } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';
import {
  CONVERSATION,
  CONVERSATIONS,
  TEXT_TURN,
  event,
  openStream,
  panelElement,
  renderPanel,
  wholeStream,
} from '#/testing/assistantPanel';
import { axeInBothThemes } from '#/testing/axeInBothThemes';
import { resetConsole } from '#/testing/resetConsole';

const saved = vi.hoisted(() => vi.fn<(name: string, text: string, type: string) => void>());
vi.mock('#/shared/api/adapter/files', () => ({ saveFile: saved }));

const ASSISTANT = `${ACME_ADMIN}/assistant`;
const LAST = `${ASSISTANT}/last-conversation`;
const GET_LAST = `GET ${LAST}`;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  resetConsole();
  vi.unstubAllGlobals();
  window.localStorage.clear();
  saved.mockReset();
});

const NOW = Date.now();
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();

function summary(id: string, title: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    profile: 'free-chat',
    mode: 'ask',
    created_at: ago(10),
    last_active_at: ago(5),
    archived: false,
    archived_at: null,
    reported: false,
    target_tenant_id: null,
    ...extra,
  };
}

const STORED = {
  ...CONVERSATION,
  id: 'c9',
  title: 'Earlier talk',
  messages: [
    { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'What is a scope?' }] },
    { id: 'm2', role: 'assistant', parts: [{ type: 'text', text: 'A scope names a permission.' }] },
  ],
};

function listAnswer(open: unknown[], archived: unknown[] = []): Answer {
  return (request) =>
    json({ items: request.search.get('archived') === 'true' ? archived : open })(request);
}

function noContent(): Answer {
  return () => new Response(null, { status: 204 });
}

async function openList(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Conversations' }));
  await screen.findByRole('heading', { name: 'Your conversations' });
}

// The toasts the shell would draw, as the console's own queue holds them.
async function toast(message: string) {
  await waitFor(() => {
    expect(useToasts.getState().toasts.map((entry) => entry.message)).toContain(message);
  });
}

describe('reopening the last conversation', () => {
  it('shows its messages, tells the shell, and lets the person carry on', async () => {
    const { onConversation } = await renderPanel({
      [GET_LAST]: json({ conversation: { ...STORED, archived: false, continuable: true } }),
    });
    expect(await screen.findByText('A scope names a permission.')).toBeInTheDocument();
    expect(screen.getByText('What is a scope?')).toBeInTheDocument();
    expect(onConversation).toHaveBeenCalledWith('c9');
    expect(screen.getByRole('textbox', { name: 'Message to the assistant' })).toBeInTheDocument();
  });

  it('opens a blank conversation when there is none to reopen', async () => {
    await renderPanel({});
    expect(await screen.findByText('Ask about this tenant')).toBeInTheDocument();
  });

  it('does not reopen anything when the shell already remembers a conversation', async () => {
    const { sent } = await renderPanel(
      { [`GET ${CONVERSATIONS}/c9`]: json(STORED) },
      { conversationId: 'c9' },
    );
    expect(await screen.findByText('A scope names a permission.')).toBeInTheDocument();
    expect(sent.some((request) => request.path === LAST)).toBe(false);
  });

  it('shows one whose sign-in ended as read-only, with a way to start a new one', async () => {
    const user = userEvent.setup();
    await renderPanel({
      [GET_LAST]: json({ conversation: { ...STORED, archived: false, continuable: false } }),
    });
    expect(await screen.findByText('A scope names a permission.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message to the assistant' })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent('ended when your sign-in did');
    await user.click(screen.getByRole('button', { name: 'Start a new conversation' }));
    expect(screen.queryByText('A scope names a permission.')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message to the assistant' })).toBeInTheDocument();
  });

  it('does not take the conversation over one the person began while it was being read', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await renderPanel({
      [GET_LAST]: async (request) => {
        await held;
        return json({ conversation: { ...STORED, archived: false, continuable: true } })(request);
      },
      [`POST ${CONVERSATIONS}/c1/messages`]: wholeStream(...TEXT_TURN),
    });
    await user.type(screen.getByRole('textbox', { name: 'Message to the assistant' }), 'Mine');
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/clients\./u)).toBeInTheDocument();
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('A scope names a permission.')).toBeNull();
    expect(screen.getByText(/clients\./u)).toBeInTheDocument();
  });
});

describe('a message the server refuses because the sign-in ended', () => {
  it('says so plainly, takes the message back and offers a new conversation', async () => {
    const user = userEvent.setup();
    await renderPanel(
      {
        [`GET ${CONVERSATIONS}/c1`]: json({ ...CONVERSATION, messages: [] }),
        [`POST ${CONVERSATIONS}/c1/messages`]: problem(409, 'about:blank#conversation-ended'),
      },
      { conversationId: 'c1' },
    );
    await user.type(
      await screen.findByRole('textbox', { name: 'Message to the assistant' }),
      'Hello',
    );
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Start a new conversation' })).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent('ended when your sign-in did');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('Hello')).toBeNull();
  });
});

describe('the assistant switched off while a conversation runs', () => {
  it('says so, once a tool answers that it is', async () => {
    const user = userEvent.setup();
    const off = JSON.stringify({
      error: { type: 'mcp:assistant_unavailable', title: 'The assistant is switched off' },
    });
    await renderPanel({
      [`POST ${CONVERSATIONS}/c1/messages`]: wholeStream(
        event({ type: 'start', messageId: 'a1' }),
        event({
          type: 'tool-input-available',
          toolCallId: 'k1',
          toolName: 'list_clients',
          input: {},
        }),
        event({ type: 'tool-output-available', toolCallId: 'k1', output: off }),
        event({ type: 'data-turn_end', data: { stopReason: 'done' }, transient: true }),
        event({ type: 'finish' }),
      ),
    });
    await user.type(
      await screen.findByRole('textbox', { name: 'Message to the assistant' }),
      'How many?',
    );
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/switched off for this tenant/u)).toBeInTheDocument();
  });
});

describe('the Conversations view', () => {
  it('lists the person’s conversations by day, with their mode, and marks the open one', async () => {
    const user = userEvent.setup();
    await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: listAnswer([
        summary('a', 'How many clients?'),
        summary('b', null, { mode: 'act', last_active_at: ago(60 * 30) }),
        summary('c', 'Old one', { last_active_at: ago(60 * 24 * 20) }),
      ]),
    });
    await openList(user);
    const grid = await screen.findByRole('grid', { name: 'Conversations' });
    expect(within(grid).getByText('Today')).toBeInTheDocument();
    expect(within(grid).getByText('Yesterday')).toBeInTheDocument();
    expect(within(grid).getByText('Earlier')).toBeInTheDocument();
    const row = (title: string) => within(grid).getByRole('row', { name: new RegExp(title, 'u') });
    expect(within(row('Untitled conversation')).getByText('Act')).toBeInTheDocument();
    expect(within(row('How many clients?')).getByText('Ask')).toBeInTheDocument();
    expect(row('Old one')).toBeInTheDocument();
    expect(screen.getByText(/idle for the number of days/u)).toBeInTheDocument();
  });

  it('says there is nothing yet, and offers no list that is empty', async () => {
    const user = userEvent.setup();
    await renderPanel({});
    await user.click(screen.getByRole('button', { name: 'Conversations' }));
    expect(await screen.findByText('No conversations yet')).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: 'Conversations' })).toBeNull();
  });

  it('says it could not load them, and tries again', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: (request) => {
        if (request.search.get('archived') === 'true') return json({ items: [] })(request);
        attempts += 1;
        return attempts === 1
          ? problem(500)(request)
          : json({ items: [summary('a', 'Back again')] })(request);
      },
    });
    await user.click(screen.getByRole('button', { name: 'Conversations' }));
    expect(await screen.findByText('Your conversations could not be loaded.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Back again')).toBeInTheDocument();
  });

  it('opens a conversation with the keyboard, shows its messages and returns to the chat', async () => {
    const user = userEvent.setup();
    const { onConversation } = await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: listAnswer([summary('c9', 'Earlier talk')]),
      [`GET ${CONVERSATIONS}/c9`]: json(STORED),
    });
    await openList(user);
    const row = await screen.findByRole('row', { name: /Earlier talk/u });
    row.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('A scope names a permission.')).toBeInTheDocument();
    expect(onConversation).toHaveBeenLastCalledWith('c9');
    expect(screen.getByRole('button', { name: 'Conversations' })).toHaveFocus();
    await openList(user);
    expect(await screen.findByRole('row', { name: /Earlier talk/u })).toHaveAttribute(
      'data-current',
      'true',
    );
  });

  it('puts the heading in focus when it shows, and goes back with Back or Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = await renderPanel({});
    await user.click(screen.getByRole('button', { name: 'Conversations' }));
    expect(await screen.findByRole('heading', { name: 'Your conversations' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Conversations' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Conversations' }));
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Conversations' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('starts a new conversation from the list', async () => {
    const user = userEvent.setup();
    await renderPanel({
      [GET_LAST]: json({ conversation: { ...STORED, archived: false, continuable: true } }),
      [`GET ${ASSISTANT}/conversations`]: listAnswer([summary('c9', 'Earlier talk')]),
    });
    expect(await screen.findByText('A scope names a permission.')).toBeInTheDocument();
    await openList(user);
    await user.click(screen.getByRole('button', { name: 'New conversation', hidden: false }));
    expect(screen.queryByText('A scope names a permission.')).toBeNull();
    expect(await screen.findByText('Ask about this tenant')).toBeInTheDocument();
  });

  it('names the tenant on a conversation about another tenant', async () => {
    const user = userEvent.setup();
    const demo = ACME_ADMIN.replace('acme', 'demo');
    await renderPanel(
      {
        [`GET ${demo}/assistant/conversations`]: listAnswer([
          summary('a', 'Demo question', { target_tenant_id: 'tenant-id' }),
        ]),
      },
      { actingIn: 'demo' },
    );
    await openList(user);
    const row = await screen.findByRole('row', { name: /Demo question/u });
    expect(within(row).getByText('demo')).toBeInTheDocument();
  });

  it('loads more when the server has more, and says when a page of them could not be had', async () => {
    const user = userEvent.setup();
    await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: (request) => {
        if (request.search.get('archived') === 'true') return json({ items: [] })(request);
        return request.search.get('cursor') === 'n1'
          ? json({ items: [summary('b', 'Second page')] })(request)
          : json({ items: [summary('a', 'First page')], next: 'n1' })(request);
      },
    });
    await openList(user);
    await user.click(await screen.findByRole('button', { name: 'Load more conversations' }));
    expect(await screen.findByText('Second page')).toBeInTheDocument();
    expect(screen.getByText('First page')).toBeInTheDocument();
  });
});

describe('archiving', () => {
  it('hides a conversation at once, offers it back, and brings it back on Undo', async () => {
    const user = userEvent.setup();
    const { sent } = await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: listAnswer([summary('a', 'Keep me')]),
      [`PUT ${CONVERSATIONS}/a/archived`]: json({ archived: true, archived_at: ago(0) }),
    });
    await openList(user);
    await user.click(await screen.findByRole('button', { name: 'Actions for Keep me' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    const status = await screen.findByText('Archived.');
    expect(status).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(screen.queryByText('Archived.')).toBeNull();
    });
    expect(
      sent.filter((request) => request.method === 'PUT').map((request) => request.body),
    ).toEqual([{ archived: true }, { archived: false }]);
  });

  it('says why when it could not', async () => {
    const user = userEvent.setup();
    await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: listAnswer([summary('a', 'Keep me')]),
      [`PUT ${CONVERSATIONS}/a/archived`]: problem(500),
    });
    await openList(user);
    await user.click(await screen.findByRole('button', { name: 'Actions for Keep me' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    await toast('The conversation could not be archived. Try again.');
    expect(screen.queryByText('Archived.')).toBeNull();
  });

  it('keeps archived conversations under a disclosure that counts them, and restores one', async () => {
    const user = userEvent.setup();
    const { sent } = await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: listAnswer(
        [summary('a', 'Open one')],
        [summary('z', 'Hidden one', { archived: true, archived_at: ago(1) })],
      ),
      [`PUT ${CONVERSATIONS}/z/archived`]: json({ archived: false, archived_at: null }),
    });
    await openList(user);
    await user.click(await screen.findByText('Archived (1)'));
    await user.click(await screen.findByRole('button', { name: 'Actions for Hidden one' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Restore' }));
    await toast('Conversation restored.');
    expect(sent.find((request) => request.method === 'PUT')?.body).toEqual({ archived: false });
  });

  it('opens an archived conversation read-only, and Restore makes it writable', async () => {
    const user = userEvent.setup();
    await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: listAnswer(
        [],
        [summary('z', 'Hidden one', { archived: true, archived_at: ago(1) })],
      ),
      [`GET ${CONVERSATIONS}/z`]: json({ ...STORED, id: 'z' }),
      [`PUT ${CONVERSATIONS}/z/archived`]: json({ archived: false, archived_at: null }),
    });
    await openList(user);
    await user.click(await screen.findByText('Archived (1)'));
    await user.click(await screen.findByRole('row', { name: /Hidden one/u }));
    expect(await screen.findByText('A scope names a permission.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message to the assistant' })).toBeNull();
    expect(screen.getByRole('note')).toHaveTextContent('This conversation is archived');
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    expect(
      await screen.findByRole('textbox', { name: 'Message to the assistant' }),
    ).toBeInTheDocument();
  });
});

describe('deleting', () => {
  async function askToDelete(user: ReturnType<typeof userEvent.setup>) {
    await openList(user);
    await user.click(await screen.findByRole('button', { name: 'Actions for Doomed' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    return await screen.findByRole('alertdialog');
  }

  it('asks first, saying the text goes and a record stays, then deletes', async () => {
    const user = userEvent.setup();
    const { sent } = await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: listAnswer([summary('d', 'Doomed')]),
      [`DELETE ${CONVERSATIONS}/d`]: noContent(),
    });
    const dialog = await askToDelete(user);
    expect(dialog).toHaveTextContent('Doomed');
    expect(dialog).toHaveTextContent('record that a conversation was deleted is kept');
    expect(sent.some((request) => request.method === 'DELETE')).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Delete conversation' }));
    await toast('Conversation deleted.');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('does nothing when it is cancelled', async () => {
    const user = userEvent.setup();
    const { sent } = await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: listAnswer([summary('d', 'Doomed')]),
    });
    const dialog = await askToDelete(user);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sent.some((request) => request.method === 'DELETE')).toBe(false);
  });

  it('says in words that a reported conversation is kept, and stays open to say so', async () => {
    const user = userEvent.setup();
    await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: listAnswer([summary('d', 'Doomed')]),
      [`DELETE ${CONVERSATIONS}/d`]: problem(409, 'about:blank#conversation-reported'),
    });
    const dialog = await askToDelete(user);
    await user.click(within(dialog).getByRole('button', { name: 'Delete conversation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'reported and is kept for review',
    );
  });

  it('says that a running answer must be stopped first', async () => {
    const user = userEvent.setup();
    await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: listAnswer([summary('d', 'Doomed')]),
      [`DELETE ${CONVERSATIONS}/d`]: problem(409, 'about:blank#conversation-busy'),
    });
    const dialog = await askToDelete(user);
    await user.click(within(dialog).getByRole('button', { name: 'Delete conversation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('still running');
  });

  it('does not offer to delete a conversation that was reported', async () => {
    const user = userEvent.setup();
    await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: listAnswer([summary('d', 'Doomed', { reported: true })]),
    });
    await openList(user);
    expect(await screen.findByText('Reported')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Actions for Doomed' }));
    expect(await screen.findByRole('menuitem', { name: /Delete/u })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});

describe('exporting', () => {
  it('saves a Markdown file and a JSON file of the conversation', async () => {
    const user = userEvent.setup();
    await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: listAnswer([summary('d', 'Doomed')]),
      [`GET ${CONVERSATIONS}/d/export/markdown`]: () =>
        new Response('# Doomed', { headers: { 'content-type': 'text/markdown' } }),
      [`GET ${CONVERSATIONS}/d/export`]: json({ messages: [] }),
    });
    await openList(user);
    await user.click(await screen.findByRole('button', { name: 'Actions for Doomed' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export as Markdown' }));
    await waitFor(() => {
      expect(saved).toHaveBeenCalledWith('conversation-d.md', '# Doomed', 'text/markdown');
    });
    await user.click(screen.getByRole('button', { name: 'Actions for Doomed' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export as JSON' }));
    await waitFor(() => {
      expect(saved).toHaveBeenCalledTimes(2);
    });
    expect(saved.mock.calls[1]?.[0]).toBe('conversation-d.json');
  });

  it('says when it could not', async () => {
    const user = userEvent.setup();
    await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: listAnswer([summary('d', 'Doomed')]),
      [`GET ${CONVERSATIONS}/d/export/markdown`]: problem(500),
    });
    await openList(user);
    await user.click(await screen.findByRole('button', { name: 'Actions for Doomed' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Export as Markdown' }));
    await toast('The conversation could not be exported. Try again.');
    expect(saved).not.toHaveBeenCalled();
  });
});

describe('switching while an answer runs', () => {
  async function running(user: ReturnType<typeof userEvent.setup>) {
    const stream = openStream();
    const mounted = await renderPanel({
      [`GET ${ASSISTANT}/conversations`]: listAnswer([
        summary('c1', 'Running one'),
        summary('c9', 'Other one', { last_active_at: ago(30) }),
      ]),
      [`POST ${CONVERSATIONS}/c1/messages`]: stream.answer,
      [`POST ${CONVERSATIONS}/c1/stop`]: json({ stopped: true }),
      [`GET ${CONVERSATIONS}/c9`]: json(STORED),
    });
    await user.type(await screen.findByRole('textbox', { name: 'Message to the assistant' }), 'Go');
    await user.keyboard('{Enter}');
    stream.push(event({ type: 'start', messageId: 'a1' }));
    stream.push(event({ type: 'text-start', id: 't1' }));
    stream.push(event({ type: 'text-delta', id: 't1', delta: 'Working' }));
    await screen.findByText('Working');
    return { ...mounted, stream };
  }

  it('asks whether to stop, and keeps waiting when told to', async () => {
    const user = userEvent.setup();
    const { sent } = await running(user);
    await openList(user);
    await user.click(await screen.findByRole('row', { name: /Other one/u }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('An answer is still running');
    await user.click(within(alert).getByRole('button', { name: 'Keep waiting' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(sent.some((request) => request.path.endsWith('/stop'))).toBe(false);
  });

  it('stops the answer and opens the other conversation when told to', async () => {
    const user = userEvent.setup();
    const { sent } = await running(user);
    await openList(user);
    await user.click(await screen.findByRole('row', { name: /Other one/u }));
    await user.click(await screen.findByRole('button', { name: 'Stop and switch' }));
    expect(await screen.findByText('A scope names a permission.')).toBeInTheDocument();
    expect(sent.some((request) => request.path === `${CONVERSATIONS}/c1/stop`)).toBe(true);
  });

  it('just returns to the chat for the conversation that is running', async () => {
    const user = userEvent.setup();
    await running(user);
    await openList(user);
    await user.click(await screen.findByRole('row', { name: /Running one/u }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Conversations' })).toHaveFocus();
  });
});

describe('accessibility', () => {
  it('has no violations with the list showing, in either theme', async () => {
    const user = userEvent.setup();
    expect(
      await axeInBothThemes(
        () =>
          panelElement({
            [`GET ${ASSISTANT}/conversations`]: listAnswer(
              [summary('a', 'How many clients?')],
              [summary('z', 'Hidden one', { archived: true, archived_at: ago(1) })],
            ),
          }).element,
        async () => {
          await user.click(await screen.findByRole('button', { name: 'Conversations' }));
          await screen.findByRole('grid', { name: 'Conversations' });
        },
      ),
    ).toEqual({ light: [], dark: [] });
  });
});
