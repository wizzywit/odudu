import {
  renderRequestedRecoveryCodesConfirmPage,
  renderRequiredActionPage,
  type PasskeyEnrolmentOffer,
  type ActionPageVariant,
  type BeginRecoveryCodesOutcome,
  type RecordActionStep,
  type RequiredAction,
  type TotpEnrolmentOffer,
} from '@odudu/authn-flows';
import { requestContextFrom, type RequestContext } from '@odudu/domain-audit';
import { type PasswordRules, type RenderedPage, tenantAddressOf } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';
import { sendHtml } from '#/view/html-response';
import { actionPages } from '#/view/routes/action-pages';
import { sendActionUnavailable, sendSignInExpired } from '#/view/routes/expired-sign-in';
import {
  continuation,
  type ContinuationDeps,
  type TenantLocales,
} from '#/view/routes/continuation';

// What every route that can produce a 'required_action' outcome needs to
// render the page for it — login.ts's own form submission and
// consent-submission.ts's third door alike, so the two cannot drift on
// which page a given action shows. `findTenant`'s own shape, not the
// repository's `TenantLookup` — the view layer never imports repository
// (CLAUDE.md's layering table), and only `id` is read here.
export interface RequiredActionResponseDeps extends ContinuationDeps {
  // Also what the change-password page tells a person about the password.
  findTenant(
    name: string,
  ): Promise<({ id: string; passwordRules: PasswordRules } & TenantLocales) | null>;
  authenticatedSubject(tenantId: string, authSessionId: string): Promise<string | null>;
  beginTotpEnrolment(
    tenantName: string,
    tenantId: string,
    subjectId: string,
  ): Promise<TotpEnrolmentOffer>;
  beginPasskeyEnrolment?(
    tenantName: string,
    tenantId: string,
    subjectId: string,
    authSessionId: string,
  ): Promise<PasskeyEnrolmentOffer>;
  // `keepHeld` leaves a set the subject already holds alone, answering `held`.
  beginRecoveryCodes(
    tenantId: string,
    subjectId: string,
    request: RequestContext,
    keepHeld?: boolean,
  ): Promise<BeginRecoveryCodesOutcome>;
  // What the tenant itself still owes the subject: an action it owes is never
  // offered a way out, whoever else asked for it.
  pendingActions(tenantId: string, subjectId: string): Promise<readonly RequiredAction[]>;
  // Whether the subject has a password at all.
  holdsPassword(tenantId: string, subjectId: string): Promise<boolean>;
  // The step an action an application requested has reached: audited, and
  // when it is an ending, parked for the response.
  recordActionStep(
    input: RecordActionStep & { tenantId: string },
    request: RequestContext,
  ): Promise<void>;
}

// The one place a 'required_action' outcome becomes a response, so login.ts,
// consent.ts and authorize.ts's session-reuse path render the same page for
// the same owed action rather than three implementations that can drift.
export async function sendRequiredActionPage(
  reply: FastifyReply,
  deps: RequiredActionResponseDeps,
  tenantName: string,
  authSessionId: string,
  subjectId: string,
  action: RequiredAction,
): Promise<FastifyReply> {
  // The first factor is verified by the time an action is owed, so the
  // subject's own locale may choose the page's language.
  const { locale, continuing, signInPath, requestedAction } = await continuation(
    deps,
    tenantName,
    authSessionId,
    reply,
    { subject: subjectId },
  );
  // The page of an action an application sent the person to may be left; the
  // page of one the tenant owes may not.
  const isAsked = requestedAction === action;
  const asked = isAsked ? await deps.findTenant(tenantName) : null;
  const owedByTenant = asked === null ? [] : await deps.pendingActions(asked.id, subjectId);
  const variant: ActionPageVariant | undefined =
    isAsked && !owedByTenant.includes(action) ? 'requested' : undefined;
  const pages = actionPages(variant);
  const record = (step: RecordActionStep['step']) =>
    asked === null
      ? Promise.resolve()
      : deps.recordActionStep(
          { tenantId: asked.id, authSessionId, subjectId, action, step },
          requestContextFrom(reply.request),
        );
  await record('requested');
  const send = (page: RenderedPage) => sendHtml(reply, 200, continuing(page));
  const beginPasskey = deps.beginPasskeyEnrolment?.bind(deps);
  if (action === 'configure-passkey' && beginPasskey !== undefined) {
    const tenant = await deps.findTenant(tenantName);
    if (tenant !== null) {
      const offer = await beginPasskey(tenantName, tenant.id, subjectId, authSessionId);
      return send(
        pages.passkey(
          tenantName,
          tenantAddressOf(reply.request),
          authSessionId,
          offer,
          undefined,
          locale,
        ),
      );
    }
  }
  if (action === 'generate-recovery-codes') {
    const tenant = await deps.findTenant(tenantName);
    if (tenant !== null) {
      // The page replaces the subject's codes as it renders, so a session
      // the flow does not yet count as finished must not reach it.
      if ((await deps.authenticatedSubject(tenant.id, authSessionId)) !== subjectId) {
        return sendSignInExpired(reply, deps, tenantName, authSessionId);
      }
      const issued = await deps.beginRecoveryCodes(
        tenant.id,
        subjectId,
        requestContextFrom(reply.request),
        variant === 'requested',
      );
      // The set was refused because no second factor is held any more, and the
      // action is cleared: signing in again goes on without it.
      if (issued.kind === 'no_second_factor') {
        if (variant === undefined) return sendSignInExpired(reply, deps, tenantName, authSessionId);
        await record('error');
        return sendActionUnavailable(reply, deps, tenantName, authSessionId);
      }
      // An application asked, and the person holds a set: nothing is replaced
      // until they say so.
      if (issued.kind === 'held') {
        return send(
          renderRequestedRecoveryCodesConfirmPage(
            tenantName,
            tenantAddressOf(reply.request),
            authSessionId,
            locale,
          ),
        );
      }
      return send(
        pages.recoveryCodes(
          tenantName,
          tenantAddressOf(reply.request),
          authSessionId,
          issued.offer,
          undefined,
          locale,
        ),
      );
    }
  }
  if (action === 'update-password') {
    const tenant = await deps.findTenant(tenantName);
    // A person who signs in without a password has none to prove or change.
    if (
      tenant !== null &&
      variant === 'requested' &&
      !(await deps.holdsPassword(tenant.id, subjectId))
    ) {
      await record('error');
      return sendActionUnavailable(reply, deps, tenantName, authSessionId);
    }
    if (tenant !== null) {
      return send(
        pages.updatePassword(
          tenantName,
          tenantAddressOf(reply.request),
          authSessionId,
          [],
          tenant.passwordRules,
          locale,
        ),
      );
    }
    return sendHtml(reply, 200, renderRequiredActionPage(action, signInPath, locale));
  }
  if (action !== 'configure-totp') {
    return sendHtml(reply, 200, renderRequiredActionPage(action, signInPath, locale));
  }
  const tenant = await deps.findTenant(tenantName);
  if (tenant === null) {
    return sendHtml(reply, 200, renderRequiredActionPage(action, signInPath, locale));
  }
  const offer = await deps.beginTotpEnrolment(tenantName, tenant.id, subjectId);
  return send(
    pages.totp(tenantName, tenantAddressOf(reply.request), authSessionId, offer, undefined, locale),
  );
}
