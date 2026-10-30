import { useState } from 'react';
import type { RemovalOutcome } from '#/shared/service/failure';
import type { AdminCapability } from '#/shared/service/principal';
import type { GatewayResult } from '#/shared/transport/gateway';

export interface AnnouncedAction<A> {
  asked: A | null;
  // The refusal, said in the dialog that asked for the action.
  problem: string | null;
  // What the last action came to, for the line the dialog leaves behind.
  notice: string | null;
  // How many actions have ended where they were meant to, or closed the
  // dialog to be looked at again, for a view that moves focus once it is gone.
  done: number;
  ask: (what: A) => void;
  cancel: () => void;
  // Whether the action ended where it was meant to.
  confirm: () => Promise<boolean>;
}

// One action behind a confirmation whose outcome is told beside the page
// after the dialog has gone: asked, sent once, and counted when it is done.
export function useAnnouncedAction<A>({
  refusal,
  capability,
  blocked = false,
  send,
  outcomeOf,
}: {
  refusal: { report: (result: GatewayResult<unknown>, needed: AdminCapability) => boolean };
  // What the action needs, named when a 403 refuses it.
  capability: AdminCapability;
  // True while another write must finish first.
  blocked?: boolean;
  send: (what: A) => Promise<GatewayResult<unknown>>;
  outcomeOf: (what: A, result: GatewayResult<unknown>) => RemovalOutcome;
}): AnnouncedAction<A> {
  const [asked, setAsked] = useState<A | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  return {
    asked,
    problem,
    notice,
    done,
    ask: (what) => {
      setProblem(null);
      setAsked(what);
    },
    cancel: () => {
      setAsked(null);
    },
    confirm: async () => {
      if (asked === null || blocked) return false;
      const result = await send(asked);
      const outcome = outcomeOf(asked, result);
      if (!outcome.done) {
        refusal.report(result, capability);
        if (outcome.closes === true) {
          // Counted so the line that now holds the text takes the focus.
          setAsked(null);
          setProblem(null);
          setNotice(outcome.text);
          setDone((count) => count + 1);
          return false;
        }
        setProblem(outcome.text);
        return false;
      }
      setAsked(null);
      setNotice(outcome.text);
      setDone((count) => count + 1);
      return true;
    },
  };
}
