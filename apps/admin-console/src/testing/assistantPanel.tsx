import { createReadCache } from '#/shared/lib/repository/readCache';
import { render } from '@testing-library/react';
import { createRef, useEffect, useState } from 'react';
import { vi } from 'vitest';
import type { AssistantView, TaskRequest } from '#/entities/assistant';
import { AssistantPanel } from '#/widgets/assistant-panel';
import { routedElement } from '#/testing/mountAtRoute';
import { fakeTransport, json, type Answer } from '#/testing/fakeTransport';
import { ACME_ADMIN } from '#/testing/tenantPaths';

export const CONVERSATIONS = `${ACME_ADMIN}/assistant/conversations`;

export const CONVERSATION = {
  id: 'c1',
  profile: 'free-chat',
  mode: 'ask',
  title: null,
  created_at: '2026-11-26T08:00:00.000Z',
  last_active_at: '2026-11-26T08:00:00.000Z',
  archived: false,
  continuable: true,
  messages: [],
};

export const VIEW: AssistantView = {
  enabled: true,
  slots: { fast: 'model-f', standard: 'model-s', deep: 'model-d' },
  modes: ['ask', 'act'],
  defaultMode: 'ask',
  modelChoices: ['model-s'],
  provider: { kind: 'anthropic' },
};

// One event of the stream a turn is answered in.
export function event(part: unknown): string {
  return `data: ${JSON.stringify(part)}\n\n`;
}

export const DONE = 'data: [DONE]\n\n';

// A reply the test writes into as it likes, to hold a turn in one state.
export function openStream({ held = false }: { held?: boolean } = {}) {
  const encoder = new TextEncoder();
  let release: () => void = () => undefined;
  const gate = held
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const answer: Answer = async () => {
    await gate;
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return {
    answer,
    // For a stream made with `held`: the server takes the turn now.
    release,
    push: (text: string): void => {
      controller?.enqueue(encoder.encode(text));
    },
    close: (): void => {
      controller?.close();
    },
  };
}

// A reply that is complete as soon as it is read.
export function wholeStream(...events: string[]): Answer {
  return () =>
    new Response(`${events.join('')}${DONE}`, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
}

export const TEXT_TURN = [
  event({ type: 'start', messageId: 'a1' }),
  event({ type: 'text-start', id: 't1' }),
  event({ type: 'text-delta', id: 't1', delta: 'There are **three** clients.' }),
  event({ type: 'text-end', id: 't1' }),
  event({ type: 'data-turn_end', data: { stopReason: 'done' }, transient: true }),
  event({ type: 'finish' }),
];

// The panel at a console page of acme, over a fake gateway, as the shell
// would draw it. `docked` is the shell's width answering for a column of its
// own; without it the panel lies over the page, as it does on a narrow screen.
export function panelElement(
  routes: Record<string, Answer>,
  options: {
    view?: AssistantView;
    conversationId?: string | null;
    docked?: boolean;
    url?: string;
    // The tenant acted in, as a system administrator in another tenant.
    actingIn?: string;
    // A task a page asked for, which the panel starts from.
    task?: TaskRequest;
  } = {},
) {
  const { view = VIEW, conversationId = null, docked = true, actingIn = null } = options;
  const first = options.task ?? null;
  const tenant = actingIn ?? 'acme';
  const url = options.url ?? `/console/${tenant}/clients/c1`;
  vi.stubGlobal('innerWidth', docked ? 1400 : 800);
  const base = `/console/api/admin/tenants/${tenant}/assistant`;
  const fake = fakeTransport({
    [`POST ${CONVERSATIONS}`]: json(CONVERSATION, 201),
    // A panel opened with no conversation remembered asks for the last one.
    [`GET ${base}/last-conversation`]: json({ conversation: null }),
    [`GET ${base}/conversations`]: json({ items: [] }),
    ...routes,
  });
  const onClose = vi.fn<() => void>();
  const onConversation = vi.fn<(id: string | null) => void>();
  // What the shell does: it keeps the id the panel reports and hands it back,
  // and it keeps the panel mounted while it is closed.
  const host: { setOpen: (open: boolean) => void; ask: (task: TaskRequest) => void } = {
    setOpen: () => undefined,
    ask: () => undefined,
  };
  const headingRef = createRef<HTMLHeadingElement>();
  function Host() {
    const [id, setId] = useState<string | null>(conversationId);
    const [open, setOpen] = useState(true);
    // As the shell does, a task is a panel of its own and forgets the conversation.
    const [task, setTask] = useState<TaskRequest | null>(first);
    useEffect(() => {
      host.setOpen = setOpen;
      host.ask = (asked) => {
        setTask(asked);
        setId(null);
      };
    }, [setOpen]);
    return (
      <AssistantPanel
        key={task?.seq ?? 0}
        task={task}
        tenant={tenant}
        actingIn={actingIn}
        username="ada"
        view={view}
        id="assistant-panel"
        label="Assistant panel"
        title="Assistant"
        closeLabel="Close"
        headingRef={headingRef}
        open={open}
        conversationId={id}
        onConversation={(next) => {
          onConversation(next);
          setId(next);
        }}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      />
    );
  }
  const { element, router } = routedElement(url, '$', Host, {
    basepath: '/console',
    providers: { transport: fake.transport, queryClient: createReadCache() },
  });
  return { ...fake, element, router, onClose, onConversation, host };
}

export async function renderPanel(...args: Parameters<typeof panelElement>) {
  const mounted = panelElement(...args);
  await mounted.router.load();
  const { unmount } = render(mounted.element);
  return { ...mounted, unmount };
}
