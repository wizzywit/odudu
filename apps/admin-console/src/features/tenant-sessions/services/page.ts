import type { EndTenantSessionsResponse, TenantSession } from '@odudu/contracts/admin';
import { tenantPage } from '#/shared/services/address';
import { writeRefusal } from '#/shared/services/capabilities';
import { writeFailureText } from '#/shared/services/failure';
import { counted } from '#/shared/services/format';
import type { GatewayFailure } from '#/shared/services/result';

export const TITLE = 'Sessions';

export const NOUN = { one: 'session', other: 'sessions' } as const;

export const PAGE_RULE =
  'Every browser sign-in in this tenant that has neither ended nor idled out, whoever holds it, in the order the server keeps them. One subject’s sessions are listed, and ended one at a time, on the subject’s own Sessions tab.';

export const NOTHING_YET = 'Nobody is signed in to this tenant.';

// The most sessions one request ends; the server does the rest on the next.
const END_LIMIT = 500;

export function sessionsHref(tenant: string): string {
  return `${tenantPage(tenant)}/sessions`;
}

// A subject is named by its username where it has one; its id is what the
// link and the detail go by.
export function subjectCell(session: Pick<TenantSession, 'subject_id' | 'username'>): {
  label: string;
  id: string;
} {
  return { label: session.username ?? session.subject_id, id: session.subject_id };
}

// Where a session's subject has its page, for a caller who may read subjects.
export function subjectLinkOf(
  mayRead: boolean,
  tenant: string,
  href: (tenant: string, id: string) => string,
): ((id: string) => string) | null {
  return mayRead ? (id) => href(tenant, id) : null;
}

// `ownTenant`: the operator's own console session belongs to this tenant.
export function endConsequence(tenant: string, ownTenant: boolean): string {
  const own = ownTenant
    ? ' Your own console session is one of them: the console signs you out at its next request.'
    : '';
  return `Every live session in ${tenant} ends, whoever holds it: each user is signed out, each session's grants are revoked, and each client with a back-channel logout URI is told. A grant bound to no session, an offline_access refresh token, is left. A session whose subject holds an admin capability you do not hold is left alone. At most ${String(END_LIMIT)} end per request; ending again ends the next.${own}`;
}

export function endedText(tenant: string, answer: EndTenantSessionsResponse): string {
  const ended = `${counted(answer.ended, 'session', 'sessions')} in ${tenant} ended.`;
  const more =
    answer.remaining > 0
      ? ` More are still live: end every session again to end the next ${String(END_LIMIT)}.`
      : '';
  const left =
    answer.beyond_ceiling === 1
      ? ' 1 was left alone: its subject holds an admin capability you do not hold.'
      : answer.beyond_ceiling > 1
        ? ` ${String(answer.beyond_ceiling)} were left alone: their subjects hold an admin capability you do not hold.`
        : '';
  return `${ended}${more}${left}`;
}

// Kept beside the action, since the toast that says the same is gone in seconds.
export function endMoreText(tenant: string, answer: EndTenantSessionsResponse): string | null {
  if (answer.remaining <= 0) return null;
  return `More sessions are still live in ${tenant}: end every session again to end the next ${String(END_LIMIT)}.`;
}

export function endFailure(tenant: string, failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name: `The end of every session in ${tenant}`,
    verb: 'done',
    lookAt: 'the sessions list',
    refused: (problem) => writeRefusal(problem, 'manage-sessions'),
  });
}
