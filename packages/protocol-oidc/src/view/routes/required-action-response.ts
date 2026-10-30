import {
  renderPasskeyEnrolmentPage,
  renderRecoveryCodesPage,
  renderRequiredActionPage,
  renderTotpEnrolmentPage,
  renderUpdatePasswordPage,
  type PasskeyEnrolmentOffer,
  type BeginRecoveryCodesOutcome,
  type RequiredAction,
  type TotpEnrolmentOffer,
} from '@odudu/authn-flows';
import { requestContextFrom, type RequestContext } from '@odudu/domain-audit';
import { type PasswordRules, type RenderedPage } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';
import { sendHtml } from '#/view/html-response';
import { sendSignInExpired } from '#/view/routes/expired-sign-in';
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
  beginRecoveryCodes(
    tenantId: string,
    subjectId: string,
    request: RequestContext,
  ): Promise<BeginRecoveryCodesOutcome>;
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
  const { locale, continuing, signInPath } = await continuation(
    deps,
    tenantName,
    authSessionId,
    reply,
    { subject: subjectId },
  );
  const send = (page: RenderedPage) => sendHtml(reply, 200, continuing(page));
  const beginPasskey = deps.beginPasskeyEnrolment?.bind(deps);
  if (action === 'configure-passkey' && beginPasskey !== undefined) {
    const tenant = await deps.findTenant(tenantName);
    if (tenant !== null) {
      const offer = await beginPasskey(tenantName, tenant.id, subjectId, authSessionId);
      return send(renderPasskeyEnrolmentPage(tenantName, authSessionId, offer, undefined, locale));
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
      );
      // The set was refused because no second factor is held any more, and the
      // action is cleared: signing in again goes on without it.
      if (issued.kind === 'no_second_factor') {
        return sendSignInExpired(reply, deps, tenantName, authSessionId);
      }
      return send(
        renderRecoveryCodesPage(tenantName, authSessionId, issued.offer, undefined, locale),
      );
    }
  }
  if (action === 'update-password') {
    const tenant = await deps.findTenant(tenantName);
    if (tenant !== null) {
      return send(
        renderUpdatePasswordPage(tenantName, authSessionId, [], tenant.passwordRules, locale),
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
  return send(renderTotpEnrolmentPage(tenantName, authSessionId, offer, undefined, locale));
}
