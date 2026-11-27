import type { GatewayResult } from '#/shared/lib/services/result';
import { decisionFailure, decisionIsFinal } from '#/widgets/assistant-panel/services/approval';
import { PANEL_WORDING } from '#/widgets/assistant-panel/services/wording';
import type {
  ApprovalCard,
  ApprovalList,
  Decision,
  Entry,
} from '#/widgets/assistant-panel/types/approvals';

// A card the person has acted on in this panel, kept with the clock offset it
// came with so it can still be drawn, as the outcome, once the server stops
// listing it as waiting.
export interface Known {
  card: ApprovalCard;
  offsetMs: number;
  decision: Decision;
}

// What was decided here, for the one conversation it was decided in.
export interface Held {
  conversation: string | null;
  known: Readonly<Record<string, Known>>;
}

export const NOTHING_HELD: Held = { conversation: null, known: {} };

function knownIn(held: Held, conversation: string | null): Readonly<Record<string, Known>> {
  return held.conversation === conversation ? held.known : {};
}

// A decision the server took is the last word on a card: a later answer from
// a second try (refused as already decided) does not take it back.
export function withDecision(held: Held, conversation: string | null, known: Known): Held {
  const before = knownIn(held, conversation);
  const kept = before[known.card.approval_id];
  const next = kept?.decision.kind === 'decided' ? kept : known;
  return { conversation, known: { ...before, [known.card.approval_id]: next } };
}

// The cards to draw: those the server holds as waiting, then those decided
// here that it no longer lists. A card the person has decided is drawn from
// what was kept, so the outcome keeps the change it was about.
export function entriesOf(
  list: ApprovalList | undefined,
  held: Held,
  conversation: string | null,
): Entry[] {
  const known = knownIn(held, conversation);
  const waiting = (list?.items ?? []).map((card): Entry => {
    const mine = known[card.approval_id];
    return {
      card: mine?.card ?? card,
      offsetMs: mine?.offsetMs ?? list?.offsetMs ?? 0,
      decision: mine?.decision,
    };
  });
  const listed = new Set(waiting.map((entry) => entry.card.approval_id));
  const decided = Object.values(known)
    .filter((mine) => !listed.has(mine.card.approval_id))
    .map((mine): Entry => ({ card: mine.card, offsetMs: mine.offsetMs, decision: mine.decision }));
  return [...waiting, ...decided];
}

// What a decision became, from the server's answer.
export function afterDecision(result: GatewayResult<{ state: 'approved' | 'denied' }>): Decision {
  if (result.ok) return { kind: 'decided', state: result.data.state };
  return { kind: 'failed', problem: decisionFailure(result), final: decisionIsFinal(result) };
}

// Whether any card still waits on the person.
export function anyWaiting(entries: readonly Entry[]): boolean {
  return entries.some(stillWaiting);
}

// A card still waiting on a person: not decided and not being decided.
export function stillWaiting(entry: Entry): boolean {
  const { decision } = entry;
  return decision === undefined || (decision.kind === 'failed' && !decision.final);
}

// The one line a screen reader is told while a change waits: nothing until the
// card is known, so the announcement is made once and names the change.
export function waitingLine(
  listStatus: 'loading' | 'ready' | 'failed',
  entries: readonly Entry[],
): string {
  if (listStatus === 'loading') return '';
  const first = entries.find(stillWaiting);
  return first === undefined
    ? PANEL_WORDING.statusWaiting
    : `${PANEL_WORDING.cardNeeded}: ${first.card.title}`;
}
