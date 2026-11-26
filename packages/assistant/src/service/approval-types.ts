import type { AssistantApprovalCard } from '@odudu/contracts/admin';

/** What the person is shown, minus what the rows around it supply. */
export type CardBody = Pick<AssistantApprovalCard, 'title' | 'target' | 'before' | 'after'>;

export type ApprovalState = 'pending' | 'approved' | 'denied' | 'expired' | 'consumed';

/** A stored card with the state and expiry of the approval it belongs to. */
export interface ApprovalCardRow {
  readonly approvalId: string;
  readonly conversationId: string;
  readonly toolCallId: string;
  readonly tool: string;
  readonly body: CardBody;
  readonly state: ApprovalState;
  readonly expiresAt: Date;
}
