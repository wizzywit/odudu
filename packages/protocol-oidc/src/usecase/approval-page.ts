import { type PresentedSession } from '@odudu/authn-flows';
import { type TenantScopedDatabase } from '@odudu/db';
import { agentApprovalRepository } from '@odudu/domain-agents';
import { clientRepository } from '@odudu/domain-tenant';
import { cibaRequestRepository } from '#/repository/ciba-requests';
import { type TenantLookup } from '#/repository/tenant-lookup';
import { decideApproval } from '#/usecase/approvals';

// What the decision form's token is bound to besides the session and the
// approval it names: a token for another purpose, such as the logout
// confirmation's, proves nothing here.
export const APPROVAL_DECISION = 'approval-decision';

// A browser can present many; the owner's is among the few it signed in last.
const MOST_SESSIONS_CONSIDERED = 10;

// What the page route reads of a tenant: whether it answers, the lifespans its
// sessions are judged by and the languages it offers.
export type ApprovalTenant = Pick<
  TenantLookup,
  | 'id'
  | 'enabled'
  | 'ssoSessionIdleSeconds'
  | 'ssoSessionMaxSeconds'
  | 'rememberMeIdleSeconds'
  | 'rememberMeMaxSeconds'
  | 'supportedLocales'
  | 'defaultLocale'
>;

export interface ApprovalDetails {
  readonly approvalId: string;
  readonly agent: string;
  readonly summary: string;
  readonly bindingMessage: string | null;
  readonly expiresAt: Date;
}

// The approval as its owner may see it: one made for a CIBA request, still
// pending and unexpired. Anything else, whoever asks, is null, so that an
// unknown approval, another person's, an expired one and a decided one cannot
// be told apart.
async function pendingFor(
  tx: TenantScopedDatabase,
  approvalId: string,
  subjectId: string,
  now: Date,
): Promise<ApprovalDetails | null> {
  const approval = await agentApprovalRepository(tx).byId(approvalId);
  if (
    approval?.kind !== 'ciba' ||
    approval.subjectId !== subjectId ||
    approval.state !== 'pending' ||
    approval.expiresAt <= now
  ) {
    return null;
  }
  const client = await clientRepository(tx).byId(approval.requestingClientId);
  const request = await cibaRequestRepository(tx).byApprovalId(approval.id);
  return {
    approvalId: approval.id,
    agent: client?.name ?? '',
    summary: approval.summary,
    bindingMessage: request?.bindingMessage ?? null,
    expiresAt: approval.expiresAt,
  };
}

export type ApprovalShown =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'show'; readonly details: ApprovalDetails; readonly csrf: string };

// The session that shows an approval is the one that belongs to its owner,
// among those a browser may hold for several accounts; a browser holding none
// of the owner's sees what a browser holding none sees.
export async function showApproval(
  tx: TenantScopedDatabase,
  input: { approvalId: string; sessions: readonly PresentedSession[]; now: Date },
): Promise<ApprovalShown> {
  for (const session of input.sessions.slice(0, MOST_SESSIONS_CONSIDERED)) {
    const details = await pendingFor(tx, input.approvalId, session.subjectId, input.now);
    if (details !== null) {
      return {
        kind: 'show',
        details,
        csrf: session.entry.proof(APPROVAL_DECISION, [input.approvalId]),
      };
    }
  }
  return { kind: 'unavailable' };
}

export type ApprovalSubmission =
  // The form's token or choice is not one this server issued.
  | { readonly kind: 'refused' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'decided'; readonly decision: 'approved' | 'denied' };

// The token proves the session that holds it and nobody else's, so the person
// who decides is the owner of the session that proves it, never a field the
// request names.
export async function submitApproval(
  tx: TenantScopedDatabase,
  deps: { tenantId: string },
  input: {
    approvalId: string;
    sessions: readonly PresentedSession[];
    csrf: string;
    choice: string | undefined;
    now: Date;
  },
): Promise<ApprovalSubmission> {
  const approve = input.choice === 'approve';
  if (!approve && input.choice !== 'deny') return { kind: 'refused' };
  const session = input.sessions.find((candidate) =>
    candidate.entry.proves(APPROVAL_DECISION, input.csrf, [input.approvalId]),
  );
  if (session === undefined) return { kind: 'refused' };

  if ((await pendingFor(tx, input.approvalId, session.subjectId, input.now)) === null) {
    return { kind: 'unavailable' };
  }
  const outcome = await decideApproval(tx, deps, {
    approvalId: input.approvalId,
    subjectId: session.subjectId,
    approve,
    via: 'ciba_page',
    now: input.now,
  });
  return outcome === 'decided'
    ? { kind: 'decided', decision: approve ? 'approved' : 'denied' }
    : { kind: 'unavailable' };
}
