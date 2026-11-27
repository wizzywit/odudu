import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useLatest } from '#/shared/lib/repository/useLatest';
import { useChatSession } from '#/widgets/assistant-panel/repository/useChatSession';
import { useConversationCalls } from '#/widgets/assistant-panel/repository/useConversationCalls';
import { useConversationRead } from '#/widgets/assistant-panel/repository/useConversationRead';
import { NO_METER, nextMeter, readStreamPart } from '#/widgets/assistant-panel/services/budget';
import { modeAfter } from '#/widgets/assistant-panel/services/modeSwitch';
import { NO_TIMES, recordStep, type StepTimes } from '#/widgets/assistant-panel/services/stepTimes';
import { useApprovals, type Approvals } from '#/widgets/assistant-panel/use-cases/useApprovals';
import { chatView } from '#/widgets/assistant-panel/services/chatView';
import { messageToSend } from '#/widgets/assistant-panel/services/composer';
import {
  refusedEndOf,
  unsentTextOf,
  readOnlyOf,
  unlessEnded,
} from '#/widgets/assistant-panel/services/conversationFlow';
import {
  historyOf,
  historyWhileResuming,
  mayShowStored,
  modeOf,
  readIdOf,
  storedOf,
} from '#/widgets/assistant-panel/services/history';
import { statusLine } from '#/widgets/assistant-panel/services/statusLine';
import { startedId } from '#/widgets/assistant-panel/services/conversationStart';
import { assistantSwitchedOff } from '#/widgets/assistant-panel/services/switchedOff';
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
import type { GatewayResult } from '#/shared/lib/services/result';
import type {
  AssistantConversation,
  AssistantResumedConversation,
  LastAssistantConversationResponse,
} from '#/widgets/assistant-panel/types/contracts';
import type { ReadOnlyReason } from '#/widgets/assistant-panel/types/conversations';

export interface AssistantChat {
  messages: PanelMessage[];
  // What the panel is doing, and the one short line that says so.
  status: PanelState;
  statusText: string;
  running: boolean;
  // Nothing can be sent: the conversation waits for a decision it cannot be given here yet.
  blocked: boolean;
  // The conversation takes no message, and why: it was archived, or the
  // sign-in it ran under has ended.
  readOnly: ReadOnlyReason | null;
  // A tool answered that the assistant was switched off while this ran.
  unavailable: boolean;
  mode: AssistantMode;
  // Switches the conversation's mode: kept for the one about to start, or sent
  // to the server for one that has.
  setMode: (mode: AssistantMode) => void;
  // Why the last switch was refused, or null.
  modeProblem: string | null;
  // The changes the conversation waits on, and what the person decides on each.
  approvals: Approvals;
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
  // What the person wrote in the message the server refused and took back, to
  // put in the message field again; null when none was.
  unsent: string | null;
  // Shows another of the person's conversations, hidden or not.
  open: (id: string, archived: boolean) => void;
  // The conversation was hidden or brought back from the list.
  markArchived: (id: string, archived: boolean) => void;
  // Reads the conversation again after it failed to load.
  retry: () => void;
}

// One conversation, from the person's first message to its last. A conversation
// that has not started is started by the first message, on the page the person
// is then looking at, and the shell is told its id so the panel can come back to it.
// The id the shell hands back is the one this panel made, so it is not read.
// A panel opened with none remembered reopens the latest one the server holds.
export function useAssistantChat(
  conversationId: string | null,
  profile: ProfileId,
  pageContext: PageContext,
  env: {
    tenant: string;
    actingIn: string | null;
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
  const [times, setTimes] = useState<StepTimes>(NO_TIMES);
  const [expectsEnd, setExpectsEnd] = useState(false);
  // Set by what the person did here (opened a hidden row, hid or restored this
  // one); until then the server's own answer for the conversation stands.
  const [archivedHere, setArchived] = useState<boolean | undefined>(undefined);
  const [resumed, setResumed] = useState<AssistantResumedConversation | undefined>(undefined);
  const [resuming, setResuming] = useState(conversationId === null);
  // The mode the person chose here; until they do, the conversation's own.
  const [chosenMode, setChosenMode] = useState<AssistantMode | null>(null);
  const [modeProblem, setModeProblem] = useState<string | null>(null);
  const loaded = storedOf(stored, asked) ?? resumed;
  const mode = chosenMode ?? modeOf(loaded);
  const latest = useLatest({ profile, pageContext, mode, onConversation: env.onConversation });

  const startConversation = async (): Promise<string> => {
    const now = latest();
    const id =
      known.current ??
      startedId(
        await calls.create({ profile: now.profile, mode: now.mode, page_context: now.pageContext }),
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
    onStep: (step) => {
      setTimes((previous) => recordStep(previous, step));
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

  // The latest conversation is taken up once, and only by a panel that has
  // nothing of its own yet: a person who began typing first keeps what they began.
  const takeUp = (found: AssistantResumedConversation): void => {
    known.current = found.id;
    seeded.current = true;
    setCreatedId(found.id);
    setResumed(found);
    setArchived(found.archived);
    session.showConversation(found);
    latest().onConversation(found.id);
  };
  const resumeWith = useEffectEvent((result: GatewayResult<LastAssistantConversationResponse>) => {
    setResuming(false);
    const found = result.ok ? result.data.conversation : null;
    if (found === null || known.current !== null) return;
    if (mayShowStored(session.status, session.messages.length)) takeUp(found);
  });
  const findLast = useEffectEvent(() => {
    if (!resuming) return;
    calls
      .last()
      .then(resumeWith)
      .catch(() => {
        setResuming(false);
      });
  });
  // Once, as the panel opens.
  useEffect(() => {
    findLast();
  }, []);

  // A message the server refused because the conversation cannot be carried on
  // (its sign-in ended for another reason, or it is hidden) is not a failure the
  // person can retry: the conversation stays to be read, and the message the
  // server did not take is not drawn as if it had.
  const refusedEnd = refusedEndOf(session.error);
  const live = unlessEnded(refusedEnd !== null, {
    chat: session.status,
    messages: session.messages,
    error: session.error,
    expectsEnd,
  });

  const drawn = chatView({
    times,
    history: historyWhileResuming(historyOf(stored, asked), resuming),
    chat: live.chat,
    messages: live.messages,
    error: live.error,
    connected,
    turn,
    meter,
    expectsEnd: live.expectsEnd,
    actingIn: env.actingIn,
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

  // Empties what the panel holds of the conversation it showed.
  const clear = (): void => {
    setCreatedId(null);
    setTurn(null);
    setConnected(false);
    setExpectsEnd(false);
    setResuming(false);
    setResumed(undefined);
    setArchived(undefined);
    setChosenMode(null);
    setModeProblem(null);
    setTimes(NO_TIMES);
    session.reset();
  };

  const startNew = (): void => {
    known.current = null;
    seeded.current = true;
    clear();
    env.onConversation(null);
  };

  const open = (id: string, hidden: boolean): void => {
    known.current = id;
    seeded.current = false;
    clear();
    setArchived(hidden);
    env.onConversation(id);
  };

  const begin = (): void => {
    setTurn(null);
    setConnected(false);
    setExpectsEnd(true);
    setMeter((previous) => nextMeter(previous, { kind: 'start' }));
  };

  const resumeTurn = (): void => {
    begin();
    session.resume().catch(() => undefined);
  };
  const approvals = useApprovals({
    tenant,
    conversationId: conversationId ?? createdId,
    waiting: drawn.state.kind === 'waiting',
    resume: resumeTurn,
  });

  const setMode = (next: AssistantMode): void => {
    setModeProblem(null);
    if (known.current === null) {
      setChosenMode(next);
      return;
    }
    calls
      .setMode(known.current, next)
      .then((result) => {
        const outcome = modeAfter(result);
        setModeProblem(outcome.problem);
        if (outcome.mode !== null) setChosenMode(outcome.mode);
      })
      .catch(() => {
        setModeProblem(modeAfter({ ok: false, kind: 'defect' }).problem);
      });
  };

  return {
    messages: drawn.messages,
    status: drawn.state,
    statusText: statusLine(drawn.state, approvals.waitingText),
    setMode,
    modeProblem,
    approvals,
    running: drawn.running,
    blocked: drawn.state.kind === 'waiting',
    readOnly: readOnlyOf({ archivedHere, server: loaded, refusedEnd }),
    unavailable: assistantSwitchedOff(session.messages),
    mode,
    note: drawn.note,
    meter: drawn.meter,
    send: (text) => {
      begin();
      session.clearError();
      session.send(messageToSend(text)).catch(() => undefined);
    },
    unsent: unsentTextOf(session.messages, refusedEnd !== null),
    canStartNew: drawn.messages.length > 0 && !drawn.running,
    startNew,
    open,
    markArchived: (id, hidden) => {
      if (id !== known.current) return;
      setArchived(hidden);
      if (!hidden) session.clearError();
    },
    stop,
    resume: resumeTurn,
    retry: () => {
      if (stored.status === 'failed') stored.retry();
    },
  };
}
