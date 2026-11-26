import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { AssistantView } from '#/entities/assistant';
import { useLatest } from '#/shared/lib/repository/useLatest';
import { useChatSession } from '#/widgets/assistant-panel/repository/useChatSession';
import { useConversationCalls } from '#/widgets/assistant-panel/repository/useConversationCalls';
import { useConversationRead } from '#/widgets/assistant-panel/repository/useConversationRead';
import { readStreamPart } from '#/widgets/assistant-panel/services/budget';
import { chatView } from '#/widgets/assistant-panel/services/chatView';
import { messageToSend } from '#/widgets/assistant-panel/services/composer';
import { historyOf, modeOf, storedOf } from '#/widgets/assistant-panel/services/history';
import { statusLine } from '#/widgets/assistant-panel/services/statusLine';
import { ChatCallError } from '#/widgets/assistant-panel/services/chatCallError';
import {
  type AssistantBudgetWarning,
  type AssistantMode,
  type Meter,
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
  // The sentence under the log when an allowance stopped the turn.
  note: string | null;
  meter: Meter;
  mode: AssistantMode;
  modeFailed: boolean;
  modeBusy: boolean;
  send: (text: string) => void;
  // Ends the answer in progress, here and on the server.
  stop: () => void;
  // Carries a turn on after a change was decided.
  resume: () => void;
  setMode: (mode: AssistantMode) => void;
  // Reads the conversation again after it failed to load.
  retry: () => void;
}

// One conversation, from the person's first message to its last. A conversation
// that has not started is started by the first message, on the page the person
// is then looking at, and the shell is told its id so the panel can come back to it.
export function useAssistantChat(
  conversationId: string | null,
  profile: ProfileId,
  pageContext: PageContext,
  env: {
    tenant: string;
    view: AssistantView;
    onConversation: (id: string) => void;
  },
): AssistantChat {
  const { tenant, view } = env;
  const calls = useConversationCalls(tenant);
  const { read: stored, asked } = useConversationRead(tenant, conversationId);
  const known = useRef<string | null>(conversationId);
  const [modeChoice, setModeChoice] = useState<AssistantMode | null>(null);
  const [modeFailed, setModeFailed] = useState(false);
  const [turn, setTurn] = useState<TurnEnd | null>(null);
  const [warning, setWarning] = useState<AssistantBudgetWarning | null>(null);
  const [connected, setConnected] = useState(false);
  const loaded = storedOf(stored, asked);
  const mode = modeOf(modeChoice, loaded, view.defaultMode);
  const latest = useLatest({ profile, pageContext, mode, onConversation: env.onConversation });

  const startConversation = async (): Promise<string> => {
    if (known.current !== null) return known.current;
    const now = latest();
    const created = await calls.create({
      profile: now.profile,
      mode: now.mode,
      page_context: now.pageContext,
    });
    if (!created.ok) throw new ChatCallError(created, 'start');
    known.current = created.data.id;
    now.onConversation(created.data.id);
    return created.data.id;
  };
  const session = useChatSession({
    tenant,
    startConversation,
    onConnected: () => {
      setConnected(true);
    },
    onData: (part) => {
      const read = readStreamPart(part);
      if (read.turn !== undefined) setTurn(read.turn);
      if (read.warning !== undefined) setWarning(read.warning);
    },
  });

  const seeded = useRef(false);
  const seed = useEffectEvent((conversation: AssistantConversation) => {
    if (seeded.current) return;
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
    warning,
  });

  const changeMode = async (next: AssistantMode): Promise<void> => {
    setModeFailed(false);
    if (known.current === null) {
      setModeChoice(next);
      return;
    }
    const changed = await calls.setMode(known.current, next);
    if (changed.ok) setModeChoice(changed.data.mode);
    else setModeFailed(true);
  };

  const stop = (): void => {
    setTurn({ stopReason: 'aborted' });
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

  return {
    messages: drawn.messages,
    status: drawn.state,
    statusText: statusLine(drawn.state),
    running: drawn.running,
    note: drawn.note,
    meter: drawn.meter,
    mode,
    modeFailed,
    modeBusy: calls.settingMode,
    send: (text) => {
      setTurn(null);
      setConnected(false);
      session.clearError();
      session.send(messageToSend(text)).catch(() => undefined);
    },
    stop,
    resume: () => {
      setTurn(null);
      setConnected(false);
      session.resume().catch(() => undefined);
    },
    setMode: (next) => {
      changeMode(next).catch(() => {
        setModeFailed(true);
      });
    },
    retry: () => {
      if (stored.status === 'failed') stored.retry();
    },
  };
}
