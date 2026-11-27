import type { AssistantApprovalCard } from '@odudu/contracts/admin';

export type ApprovalCard = AssistantApprovalCard;

// One line of the change a card shows: the field, what it is now and what it
// would become. `change` is said in words beside the values, so it never rests
// on colour alone.
export interface DiffRow {
  label: string;
  before: string;
  after: string;
  change: 'added' | 'removed' | 'changed' | 'same';
}

// One side of a set change: its heading with the count, and every name whole.
export interface SetSide {
  heading: string;
  names: readonly string[];
  empty: string;
}

// What the person has done with a card in this panel.
export type Decision =
  | { kind: 'deciding'; approve: boolean }
  | { kind: 'decided'; state: 'approved' | 'denied' }
  // `final`: the server will refuse it again (decided, expired, not yours), so it is not offered again.
  | { kind: 'failed'; problem: string; final: boolean };

// The cards the server holds for the conversation, with how far its clock is
// from this browser's when it answered.
export interface ApprovalList {
  items: readonly ApprovalCard[];
  // Server time minus the browser's, in milliseconds; zero when the server sent none.
  offsetMs: number;
}

// A card to draw, with the clock offset it was read with and what the person has done with it.
export interface Entry {
  card: ApprovalCard;
  offsetMs: number;
  decision: Decision | undefined;
}

export type CardStatus = 'pending' | 'deciding' | 'approved' | 'refused' | 'expired' | 'closed';

export interface CardModel {
  id: string;
  // The line over the title: the change waits for approval, and where it lands.
  kicker: string;
  // The tenant the change is made in, when it is not the person's own.
  tenant: string | null;
  tenantNote: string | null;
  tier: ApprovalCard['tier'];
  // What the card says its tier asks of the person; null for tier A.
  tierNote: string | null;
  // The extra question a tier B or C change is asked before it is approved, and
  // the text that holds the answer until typed, when there is one.
  dialog: { title: string; consequence: string; confirmLabel: string; typed: string | null };
  // What a change that replaces a list adds and removes; null for any other.
  set: { added: SetSide; removed: SetSide } | null;
  title: string;
  targetType: string;
  targetName: string | null;
  targetId: string | null;
  // The label of the control that copies the target's id.
  copyLabel: string;
  creating: boolean;
  rows: readonly DiffRow[];
  who: string;
  status: CardStatus;
  // The countdown's words, or the outcome's once the card is decided or expired.
  remaining: string;
  // What a screen reader is told of the time left: only at one minute and at expiry.
  announcement: string;
  outcome: string | null;
  problem: string | null;
  risky: boolean;
}
