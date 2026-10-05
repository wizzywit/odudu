import {
  renderPasskeyEnrolmentPage,
  renderRecoveryCodesPage,
  renderRequiredActionPage,
  renderTotpEnrolmentPage,
  renderUpdatePasswordPage,
  type PasskeyEnrolmentOffer,
  type RecoveryCodesOffer,
  type RequiredAction,
  type TotpEnrolmentOffer,
} from '@odudu/authn-flows';
import { requestContextFrom, type RequestContext } from '@odudu/domain-audit';
import { type RenderedPage } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';
import { sendHtml } from '#/view/html-response';
import { continuing, type ContinuationDeps } from '#/view/routes/continuation';

// What every route that can produce a 'required_action' outcome needs to
// render the page for it — login.ts's own form submission and
// consent-submission.ts's third door alike, so the two cannot drift on
// which page a given action shows. `findTenant`'s own shape, not the
// repository's `TenantLookup` — the view layer never imports repository
// (CLAUDE.md's layering table), and only `id` is read here.
export interface RequiredActionResponseDeps extends ContinuationDeps {
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
  ): Promise<RecoveryCodesOffer>;
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
  const send = async (page: RenderedPage) =>
    sendHtml(reply, 200, await continuing(deps, tenantName, authSessionId, page));
  const beginPasskey = deps.beginPasskeyEnrolment?.bind(deps);
  if (action === 'configure-passkey' && beginPasskey !== undefined) {
    const tenant = await deps.findTenant(tenantName);
    if (tenant !== null) {
      const offer = await beginPasskey(tenantName, tenant.id, subjectId, authSessionId);
      return send(renderPasskeyEnrolmentPage(tenantName, authSessionId, offer));
    }
  }
  if (action === 'generate-recovery-codes') {
    const tenant = await deps.findTenant(tenantName);
    if (tenant !== null) {
      const offer = await deps.beginRecoveryCodes(
        tenant.id,
        subjectId,
        requestContextFrom(reply.request),
      );
      return send(renderRecoveryCodesPage(tenantName, authSessionId, offer));
    }
  }
  if (action === 'update-password') {
    return send(renderUpdatePasswordPage(tenantName, authSessionId));
  }
  if (action !== 'configure-totp') {
    return sendHtml(reply, 200, renderRequiredActionPage(action));
  }
  const tenant = await deps.findTenant(tenantName);
  if (tenant === null) {
    return sendHtml(reply, 200, renderRequiredActionPage(action));
  }
  const offer = await deps.beginTotpEnrolment(tenantName, tenant.id, subjectId);
  return send(renderTotpEnrolmentPage(tenantName, authSessionId, offer));
}
