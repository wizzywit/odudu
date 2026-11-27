import type { StepState } from '#/widgets/assistant-panel/types/chat';
import type { GatewayFailure } from '#/shared/lib/services/result';
import {
  PANEL_WORDING,
  changeInKicker,
  changeTenantNote,
  removalIn,
  setHeading,
  typedChangeIn,
  expiresInMinutes,
  expiresInSeconds,
  copyIdLabel,
  youAs,
} from '#/widgets/assistant-panel/services/wording';
import type {
  ApprovalCard,
  CardModel,
  CardStatus,
  Decision,
  DiffRow,
  SetSide,
} from '#/widgets/assistant-panel/types/approvals';

type Fields = ApprovalCard['before'];

// The changes the assistant can propose, by tool, so a step that finished or was
// refused can be told apart from a read. A test holds this to the server's list.
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'update_client_metadata',
  'update_scope_metadata',
  'update_role_description',
  'update_group_description',
  'create_role',
  'create_group',
  'create_scope',
  'update_tenant_text_settings',
  'set_message_override',
  'clear_message_override',
  'update_theme_draft',
  'update_client_theme_draft',
]);

function valueText(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined || value === '') return PANEL_WORDING.valueEmpty;
  return String(value);
}

function labelText(field: string): string {
  const spaced = field.replace(/_/gu, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// The rows of the change: every field either side names, in the order the new
// state gives them, with the fields only the old state had after those.
export function diffRows(before: Fields, after: Fields): DiffRow[] {
  const next = after ?? {};
  const previous = before ?? {};
  const names = [...Object.keys(next), ...Object.keys(previous).filter((name) => !(name in next))];
  return names.map((name): DiffRow => {
    const had = name in previous;
    const has = name in next;
    const old = previous[name];
    const now = next[name];
    const unchanged = had && has && old === now;
    let change: DiffRow['change'] = 'changed';
    if (unchanged) change = 'same';
    else if (!had) change = 'added';
    else if (!has) change = 'removed';
    return {
      label: labelText(name),
      before: had ? valueText(old) : PANEL_WORDING.valueAbsent,
      after: has ? valueText(now) : PANEL_WORDING.valueAbsent,
      change,
    };
  });
}

// Server time minus the browser's, from the `Date` header of an answer. The
// header has whole seconds and says the second the server was in, so the
// server is taken to be at the end of it: a card is never shown open for a
// moment the server has already closed it.
export function clockOffset(serverDate: string | null, browserNowMs: number): number {
  if (serverDate === null) return 0;
  const at = Date.parse(serverDate);
  return Number.isNaN(at) ? 0 : at + 999 - browserNowMs;
}

// Whole seconds until the server's own expiry, by the server's clock, never below zero.
export function secondsLeft(expiresAt: string, browserNowMs: number, offsetMs: number): number {
  const end = Date.parse(expiresAt);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, Math.ceil((end - (browserNowMs + offsetMs)) / 1_000));
}

const MINUTE = 60;

export function countdownText(seconds: number): string {
  if (seconds <= 0) return PANEL_WORDING.cardExpired;
  if (seconds > MINUTE) return expiresInMinutes(Math.ceil(seconds / MINUTE));
  return expiresInSeconds(seconds);
}

// What a screen reader is told of the time: nothing until a minute is left,
// that, and then the expiry. The words change only at those two moments, so a
// polite live region says each once.
export function countdownAnnouncement(seconds: number): string {
  if (seconds <= 0) return PANEL_WORDING.cardExpiredAnnounce;
  return seconds <= MINUTE ? PANEL_WORDING.cardMinuteLeft : '';
}

// Why a decision did not go through, in words the person can act on.
// Whether trying the same decision again can only be refused again.
export function decisionIsFinal(failure: GatewayFailure): boolean {
  return failure.kind === 'problem' && [403, 404, 409].includes(failure.problem.status);
}

export function decisionFailure(failure: GatewayFailure): string {
  if (failure.kind !== 'problem') {
    return failure.kind === 'network' ? PANEL_WORDING.decideNetwork : PANEL_WORDING.decideDefect;
  }
  switch (failure.problem.status) {
    case 409:
      return PANEL_WORDING.decideConflict;
    case 403:
      return PANEL_WORDING.decideForbidden;
    case 404:
      return PANEL_WORDING.decideGone;
    default:
      return PANEL_WORDING.decideDefect;
  }
}

function statusOf(decision: Decision | undefined, seconds: number): CardStatus {
  if (decision?.kind === 'decided') return decision.state === 'approved' ? 'approved' : 'refused';
  if (decision?.kind === 'deciding') return 'deciding';
  if (decision?.kind === 'failed' && decision.final) return 'closed';
  return seconds <= 0 ? 'expired' : 'pending';
}

// What an approval became once the step it was for has run or not: the server
// takes the decision first and the assistant makes the change when its answer
// carries on, so "made" is said only of a step that is done.
function approvedOutcome(step: StepState | undefined): string {
  if (step === 'done') return PANEL_WORDING.cardApproved;
  if (step === 'failed' || step === 'denied') return PANEL_WORDING.cardApprovedFailed;
  return PANEL_WORDING.cardApplying;
}

function outcomeOf(status: CardStatus, step: StepState | undefined): string | null {
  switch (status) {
    case 'deciding':
      return PANEL_WORDING.cardDeciding;
    case 'approved':
      return approvedOutcome(step);
    case 'refused':
      return PANEL_WORDING.cardRefused;
    case 'expired':
      return PANEL_WORDING.cardExpiredOutcome;
    default:
      return null;
  }
}

const TIME_WORDS: Readonly<Record<Exclude<CardStatus, 'pending'>, string>> = {
  deciding: PANEL_WORDING.cardDecidingShort,
  approved: PANEL_WORDING.cardDecided,
  refused: PANEL_WORDING.cardDecided,
  expired: PANEL_WORDING.cardExpired,
  closed: PANEL_WORDING.cardClosed,
};

// The time row: the countdown while the card waits, and a word once it does not.
function remainingText(status: CardStatus, seconds: number): string {
  return status === 'pending' ? countdownText(seconds) : TIME_WORDS[status];
}

function setSide(label: string, names: readonly string[]): SetSide {
  return { heading: setHeading(label, names.length), names, empty: PANEL_WORDING.setNone };
}

// The names a change that replaces a list adds and removes, each whole.
export function setModel(diff: ApprovalCard['diff']): CardModel['set'] {
  if (diff === undefined) return null;
  return {
    added: setSide(PANEL_WORDING.setAdds, diff.added),
    removed: setSide(PANEL_WORDING.setRemoves, diff.removed),
  };
}

// What the card says its tier asks of the person, or nothing for one that
// only needs an answer.
function tierNote(tier: ApprovalCard['tier']): string | null {
  if (tier === 'B') return PANEL_WORDING.tierBNote;
  return tier === 'C' ? PANEL_WORDING.tierCNote : null;
}

// The question asked once more before the approval is sent. A removal is asked
// plainly; a change that decides who can sign in holds the answer until the
// name the server wrote is typed.
function dialogOf(
  tier: ApprovalCard['tier'],
  confirmWith: string | null,
  tenant: string | null,
): CardModel['dialog'] {
  if (tier === 'C' && confirmWith !== null) {
    const words =
      tenant === null
        ? { title: PANEL_WORDING.typedTitle, consequence: PANEL_WORDING.typedConsequence }
        : typedChangeIn(tenant);
    return { ...words, confirmLabel: PANEL_WORDING.typedConfirm, typed: confirmWith };
  }
  const words =
    tenant === null
      ? { title: PANEL_WORDING.removeTitle, consequence: PANEL_WORDING.removeConsequence }
      : removalIn(tenant);
  return { ...words, confirmLabel: PANEL_WORDING.removeConfirm, typed: null };
}

// A card as the view draws it: the server's stored change, who decides, the time
// that is left and, once there is one, the outcome that takes the buttons' place.
export function cardModel(input: {
  card: ApprovalCard;
  username: string;
  // The tenant the change is made in when it is not the person's own.
  tenant: string | null;
  decision: Decision | undefined;
  seconds: number;
  // How the step that proposed the change stands, which says whether it was made.
  step?: StepState | undefined;
}): CardModel {
  const { card, username, tenant, decision, seconds, step } = input;
  const status = statusOf(decision, seconds);
  return {
    id: card.approval_id,
    kicker: tenant === null ? PANEL_WORDING.cardLabel : changeInKicker(tenant),
    tenant,
    tenantNote: tenant === null ? null : changeTenantNote(tenant),
    tier: card.tier,
    tierNote: tierNote(card.tier),
    dialog: dialogOf(card.tier, card.confirm_with, tenant),
    set: setModel(card.diff),
    title: card.title,
    targetType: card.target.type,
    targetName: card.target.name ?? null,
    targetId: card.target.id ?? null,
    copyLabel: copyIdLabel(card.target.type),
    creating: card.before === null,
    rows: diffRows(card.before, card.after),
    who: youAs(username),
    status,
    remaining: remainingText(status, seconds),
    announcement:
      status === 'pending' || status === 'expired' ? countdownAnnouncement(seconds) : '',
    outcome: outcomeOf(status, step),
    problem: decision?.kind === 'failed' ? decision.problem : null,
    risky: card.tier !== 'A',
  };
}

// What a finished step says of its approval when the card itself is no longer
// held: the part's state is all a later visit has of it.
export function outcomeOfStep(
  tool: string,
  state: 'running' | 'waiting' | 'done' | 'failed' | 'denied',
): string | null {
  if (!WRITE_TOOLS.has(tool)) return null;
  if (state === 'done') return PANEL_WORDING.stepApproved;
  if (state === 'failed') return PANEL_WORDING.stepApprovedFailed;
  if (state === 'denied') return PANEL_WORDING.stepNotApproved;
  return null;
}

// Whether a card may be answered now: not while an answer is on its way, and
// never again once the server has taken one.
export function mayAnswer(decision: Decision | undefined): boolean {
  return decision === undefined || (decision.kind === 'failed' && !decision.final);
}

// What approving does: ask once more for a change of tier B or C, send the
// approval for every other.
export function approveRoute(asksAgain: boolean): 'confirm' | 'send' {
  return asksAgain ? 'confirm' : 'send';
}

// What a confirmed approval sends beside it: the name the server asked to be
// typed, for a card of tier C, and nothing for any other.
export function confirmArgs(dialog: CardModel['dialog']): [] | [string] {
  return dialog.typed === null ? [] : [dialog.typed];
}

// The extra question stays open only while the card can still be answered.
export function confirmOpen(asked: boolean, status: CardStatus): boolean {
  return asked && status === 'pending';
}

// Whether the answer carries on: only once the server took the decision.
export function resumes(decision: Decision): boolean {
  return decision.kind === 'decided';
}
