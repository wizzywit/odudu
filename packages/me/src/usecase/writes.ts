import type { MeAmendProfileRequest } from '@odudu/contracts/me';
import type { UserRecord } from '@odudu/domain-identity';
import { isUuid } from '@odudu/kernel';
import type { MeWrites } from '#/repository/writes';
import {
  consentRevokedEvent,
  emailChangeRequestedEvent,
  credentialRemovedEvent,
  credentialRenamedEvent,
  profileAmendedEvent,
  recoveryCodesRevokedEvent,
  sessionEndedEvent,
  sessionsEndedEvent,
} from '#/service/audit';
import { planEmailChange, proofLocale } from '#/service/email-change';
import { removalNotice, type NoticeOutcome } from '#/service/notice';
import { UsernameTakenError } from '#/service/errors';
import { credentialView, type CredentialView } from '#/service/credential-view';
import { fetchLimit, splitPage } from '#/service/page';
import { planProfileAmend } from '#/service/profile-amend';
import { canRemove, HELD_LIMIT, isRemovable, type RemovalRefusal } from '#/service/removal-rule';
import { SESSION_END_LIMIT } from '#/service/session-end';
import { isTokenSession } from '#/service/session-view';
import type { MeCaller } from '#/usecase/admit-me';

export interface MeWriteDeps {
  readonly writes: MeWrites;
  readonly now: () => Date;
}

const NOT_FOUND = { kind: 'not_found' } as const;

const actorOf = (caller: MeCaller) => ({ subjectId: caller.subjectId, clientId: caller.clientId });

export type AmendProfileOutcome =
  | typeof NOT_FOUND
  | { readonly kind: 'invalid_value'; readonly field: string; readonly description: string }
  | { readonly kind: 'username_taken' }
  | { readonly kind: 'ok'; readonly profile: UserRecord };

export async function amendProfile(
  deps: MeWriteDeps,
  caller: MeCaller,
  values: MeAmendProfileRequest,
): Promise<AmendProfileOutcome> {
  try {
    return await amendProfileInTransaction(deps, caller, values);
  } catch (error) {
    if (error instanceof UsernameTakenError) return { kind: 'username_taken' };
    throw error;
  }
}

function amendProfileInTransaction(
  deps: MeWriteDeps,
  caller: MeCaller,
  values: MeAmendProfileRequest,
): Promise<AmendProfileOutcome> {
  return deps.writes.transact(caller.tenantId, async (tx): Promise<AmendProfileOutcome> => {
    const current = await tx.lockProfile(caller.subjectId);
    if (current === null) return NOT_FOUND;
    const plan = planProfileAmend(current, values);
    if (plan.kind === 'invalid_value') return plan;
    if (plan.kind === 'unchanged') return { kind: 'ok', profile: current };

    // Unverified first: the row never holds a verified number it is changing.
    if (plan.verification !== null) await tx.setVerification(caller.subjectId, plan.verification);
    const renamed =
      plan.username === null ? current : await tx.renameUser(caller.subjectId, plan.username);
    const profile =
      plan.profile === null ? renamed : await tx.updateProfile(caller.subjectId, plan.profile);
    await tx.audit(profileAmendedEvent(actorOf(caller), plan.fields));
    return { kind: 'ok', profile };
  });
}

export type EndSessionOutcome =
  typeof NOT_FOUND | { readonly kind: 'ended'; readonly currentSessionEnded: boolean };

export async function endSession(
  deps: MeWriteDeps,
  caller: MeCaller,
  sessionId: string,
): Promise<EndSessionOutcome> {
  if (!isUuid(sessionId)) return NOT_FOUND;
  return deps.writes.transact(caller.tenantId, async (tx): Promise<EndSessionOutcome> => {
    if (!(await tx.lockOwnedSession(caller.subjectId, sessionId))) return NOT_FOUND;
    await tx.endSessions({
      subjectId: caller.subjectId,
      sessionIds: [sessionId],
      now: deps.now(),
      issuer: caller.issuer,
    });
    const current = isTokenSession(sessionId, caller.sessionId);
    await tx.audit(sessionEndedEvent(actorOf(caller), sessionId, current));
    return { kind: 'ended', currentSessionEnded: current };
  });
}

export interface EndOtherSessionsOutcome {
  readonly kind: 'ended';
  readonly ended: number;
  readonly more: boolean;
}

// The sessions other than the token's own, a bounded number at a time.
export function endOtherSessions(
  deps: MeWriteDeps,
  caller: MeCaller,
): Promise<EndOtherSessionsOutcome> {
  return deps.writes.transact(caller.tenantId, async (tx): Promise<EndOtherSessionsOutcome> => {
    const now = deps.now();
    const found = await tx.liveSessionIds(
      caller.subjectId,
      now,
      fetchLimit(SESSION_END_LIMIT),
      caller.sessionId,
    );
    const { items, hasMore } = splitPage(found, SESSION_END_LIMIT);
    if (items.length === 0) return { kind: 'ended', ended: 0, more: false };
    await tx.endSessions({
      subjectId: caller.subjectId,
      sessionIds: items,
      now,
      issuer: caller.issuer,
    });
    await tx.audit(sessionsEndedEvent(actorOf(caller), items.length, hasMore));
    return { kind: 'ended', ended: items.length, more: hasMore };
  });
}

export type RevokeConsentOutcome = typeof NOT_FOUND | { readonly kind: 'revoked' };

export function revokeConsent(
  deps: MeWriteDeps,
  caller: MeCaller,
  clientKey: string,
): Promise<RevokeConsentOutcome> {
  return deps.writes.transact(caller.tenantId, async (tx): Promise<RevokeConsentOutcome> => {
    const revoked = await tx.revokeConsent(caller.subjectId, clientKey, deps.now());
    if (revoked === null) return NOT_FOUND;
    await tx.audit(
      consentRevokedEvent(actorOf(caller), clientKey, revoked.scopeNames, revoked.grantsRevoked),
    );
    return { kind: 'revoked' };
  });
}

export type RenameCredentialOutcome =
  typeof NOT_FOUND | { readonly kind: 'renamed'; readonly credential: CredentialView };

export async function renameCredential(
  deps: MeWriteDeps,
  caller: MeCaller,
  credentialId: string,
  label: string,
): Promise<RenameCredentialOutcome> {
  if (!isUuid(credentialId)) return NOT_FOUND;
  return deps.writes.transact(caller.tenantId, async (tx): Promise<RenameCredentialOutcome> => {
    const credential = await tx.renameCredential(caller.subjectId, credentialId, label);
    const view = credential === null ? null : credentialView(credential);
    if (view === null) return NOT_FOUND;
    await tx.audit(credentialRenamedEvent(actorOf(caller), credentialId, view.type));
    return { kind: 'renamed', credential: view };
  });
}

export type RemoveCredentialOutcome =
  | typeof NOT_FOUND
  | { readonly kind: 'refused'; readonly code: RemovalRefusal }
  | { readonly kind: 'removed' };

// The subject's row is locked first, so two removals by one person take turns
// and the second judges what the first left.
export async function removeCredential(
  deps: MeWriteDeps,
  caller: MeCaller,
  credentialId: string,
): Promise<RemoveCredentialOutcome> {
  if (!isUuid(credentialId)) return NOT_FOUND;
  return deps.writes.transact(caller.tenantId, async (tx): Promise<RemoveCredentialOutcome> => {
    if ((await tx.lockProfile(caller.subjectId)) === null) return NOT_FOUND;
    const target = await tx.credentialOf(caller.subjectId, credentialId);
    if (target === null || !isRemovable(target.type)) return NOT_FOUND;
    const verdict = canRemove(
      await tx.heldCredentials(caller.subjectId, HELD_LIMIT),
      target,
      await tx.tenantRequiresSecondFactor(),
    );
    if (!verdict.ok) return { kind: 'refused', code: verdict.code };

    await tx.deleteCredential(target.id);
    const revoked = await tx.afterSecondFactorRemoved(caller.subjectId);
    const notice = await tx.noticeOwnChange(
      caller.subjectId,
      removalNotice(target.type, revoked),
      deps.now(),
    );
    await tx.audit(credentialRemovedEvent(actorOf(caller), target.id, target.type, notice));
    if (revoked > 0) await tx.audit(recoveryCodesRevokedEvent(actorOf(caller), revoked));
    return { kind: 'removed' };
  });
}

export type RequestEmailChangeOutcome =
  typeof NOT_FOUND | { readonly kind: 'mail_unavailable' } | { readonly kind: 'accepted' };

// Every address that reaches the transaction is answered as accepted, so the
// response says nothing about who holds it; the audit row does. Whether mail
// can be sent at all is judged first, since it does not depend on the address.
export function requestEmailChange(
  deps: MeWriteDeps,
  caller: MeCaller,
  email: string,
): Promise<RequestEmailChangeOutcome> {
  return deps.writes.transact(caller.tenantId, async (tx): Promise<RequestEmailChangeOutcome> => {
    const current = await tx.lockProfile(caller.subjectId);
    if (current === null) return NOT_FOUND;
    if (!(await tx.mailIsAvailable())) return { kind: 'mail_unavailable' };
    const plan = planEmailChange({
      holder: await tx.holderOfEmail(email),
      subjectId: caller.subjectId,
      withinBudget: tx.mailBudgetAllows(email),
    });
    // Whatever the plan, an address asked for earlier is no longer wanted.
    let notice: NoticeOutcome | null = null;
    if (plan.kind === 'send') {
      await tx.setPendingEmail(caller.subjectId, email);
      await tx.queueAddressProof({
        subjectId: caller.subjectId,
        email,
        locale: proofLocale(current),
        now: deps.now(),
      });
      notice = await tx.noticeOwnChange(
        caller.subjectId,
        { kind: 'address_change_requested' },
        deps.now(),
      );
    } else {
      await tx.clearPendingEmail(caller.subjectId);
    }
    await tx.audit(emailChangeRequestedEvent(actorOf(caller), plan, notice));
    return { kind: 'accepted' };
  });
}
