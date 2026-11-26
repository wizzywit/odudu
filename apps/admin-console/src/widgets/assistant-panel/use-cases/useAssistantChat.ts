import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useLatest } from '#/shared/lib/repository/useLatest';
import { useChatSession } from '#/widgets/assistant-panel/repository/useChatSession';
import { useConversationCalls } from '#/widgets/assistant-panel/repository/useConversationCalls';
import { useConversationRead } from '#/widgets/assistant-panel/repository/useConversationRead';
import { NO_METER, nextMeter, readStreamPart } from '#/widgets/assistant-panel/services/budget';
import { chatView } from '#/widgets/assistant-panel/services/chatView';
import { messageToSend } from '#/widgets/assistant-panel/services/composer';
import {
  historyOf,
  mayShowStored,
  modeOf,
  readIdOf,
  storedOf,
} from '#/widgets/assistant-panel/services/history';
import { statusLine } from '#/widgets/assistant-panel/services/statusLine';
import { startedId } from '#/widgets/assistant-panel/services/conversationStart';
import {
  type AssistantMode,
  type Meter,
  type MeterState,
  type PageContext,
  type PanelMessage,
  type PanelState,
  type ProfileId,
  type TurnEnd,
} from '#/widgets/assistant-panel/types/chat';
import type { AssistantConversation } from '#/widgets/assistant-panel/types/contracts';

export interface AssistantChat {
  messages: PanelMessage[];
  // What the panel is doing, and the one short line that says so.
  status: PanelState;
  statusText: string;
  running: boolean;
  // Nothing can be sent: the conversation waits for a decision it cannot be given here yet.
  blocked: boolean;
  mode: AssistantMode;
  // The sentence under the log when an allowance stopped the turn.
  note: string | null;
  // Null until the server has said something about the allowance.
  meter: Meter | null;
  send: (text: string) => void;
  // Ends the answer in progress, here and on the server.
  stop: () => void;
  // Carries a turn on after a change was decided.
  resume: () => void;
  // A new conversation can be started: there is one, and nothing is running.
  canStartNew: boolean;
  startNew: () => void;
  // Reads the conversation again after it failed to load.
  retry: () => void;
}

// One conversation, from the person's first message to its last. A conversation
// that has not started is started by the first message, on the page the person
// is then looking at, and the shell is told its id so the panel can come back to it.
// The id the shell hands back is the one this panel made, so it is not read.
export function useAssistantChat(
  conversationId: string | null,
  profile: ProfileId,
  pageContext: PageContext,
  env: {
    tenant: string;
    onConversation: (id: string | null) => void;
  },
): AssistantChat {
  const { tenant } = env;
  const calls = useConversationCalls(tenant);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const { read: stored, asked } = useConversationRead(tenant, readIdOf(conversationId, createdId));
  const known = useRef<string | null>(conversationId);
  const [turn, setTurn] = useState<TurnEnd | null>(null);
  const [meter, setMeter] = useState<MeterState>(NO_METER);
  const [connected, setConnected] = useState(false);
  const [expectsEnd, setExpectsEnd] = useState(false);
  const loaded = storedOf(stored, asked);
  const mode = modeOf(loaded);
  const latest = useLatest({ profile, pageContext, onConversation: env.onConversation });

  const startConversation = async (): Promise<string> => {
    const now = latest();
    const id =
      known.current ??
      startedId(
        await calls.create({ profile: now.profile, mode: 'ask', page_context: now.pageContext }),
      );
    if (known.current === null) {
      known.current = id;
      setCreatedId(id);
      now.onConversation(id);
    }
    return id;
  };
  const session = useChatSession({
    tenant,
    startConversation,
    onConnected: () => {
      setConnected(true);
    },
    onData: (part) => {
      const read = readStreamPart(part);
      if (read.turn !== undefined) {
        const ended = read.turn;
        setTurn(ended);
        setExpectsEnd(false);
        setMeter((previous) => nextMeter(previous, { kind: 'turn', turn: ended }));
      }
      if (read.warning !== undefined) {
        const warning = read.warning;
        setMeter((previous) => nextMeter(previous, { kind: 'warning', warning }));
      }
    },
  });

  const seeded = useRef(false);
  const seed = useEffectEvent((conversation: AssistantConversation) => {
    if (seeded.current || !mayShowStored(session.status, session.messages.length)) return;
    seeded.current = true;
    session.showConversation(conversation);
  });
  useEffect(() => {
    if (loaded !== undefined) seed(loaded);
  }, [loaded]);

  const drawn = chatView({
    history: historyOf(stored, asked),
    chat: session.status,
    messages: session.messages,
    error: session.error,
    connected,
    turn,
    meter,
    expectsEnd,
    act: mode === 'act',
  });

  const stop = (): void => {
    setTurn({ stopReason: 'aborted' });
    setExpectsEnd(false);
    session.abort().catch(() => undefined);
    if (known.current !== null) calls.stop(known.current).catch(() => undefined);
  };
  const stopOnLeave = useEffectEvent(() => {
    if (drawn.running) stop();
  });
  useEffect(
    () => () => {
      stopOnLeave();
    },
    [],
  );

  const startNew = (): void => {
    known.current = null;
    seeded.current = true;
    setCreatedId(null);
    setTurn(null);
    setConnected(false);
    setExpectsEnd(false);
    session.reset();
    env.onConversation(null);
  };

  const begin = (): void => {
    setTurn(null);
    setConnected(false);
    setExpectsEnd(true);
    setMeter((previous) => nextMeter(previous, { kind: 'start' }));
  };

  return {
    messages: drawn.messages,
    status: drawn.state,
    statusText: statusLine(drawn.state),
    running: drawn.running,
    blocked: drawn.state.kind === 'waiting',
    mode,
    note: drawn.note,
    meter: drawn.meter,
    send: (text) => {
      begin();
      session.clearError();
      session.send(messageToSend(text)).catch(() => undefined);
    },
    canStartNew: drawn.messages.length > 0 && !drawn.running,
    startNew,
    stop,
    resume: () => {
      begin();
      session.resume().catch(() => undefined);
    },
    retry: () => {
      if (stored.status === 'failed') stored.retry();
    },
  };
}
