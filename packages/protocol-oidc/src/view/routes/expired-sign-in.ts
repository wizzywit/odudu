import { type PendingRequest } from '@odudu/authn-flows';
import { negotiatePageLocale } from '@odudu/i18n';
import { brandLocale, withPageTheme, tenantAddressOf } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';
import { requestedActionOf } from '#/service/action-request';
import { restartAuthorizeLocation } from '#/service/restart-request';
import { errorRedirect } from '#/usecase/login-submission';
import { renderAuthorizeErrorPage, type WayOn } from '#/view/authorize-html';
import { sendHtml } from '#/view/html-response';
import { t } from '#/view/messages';
import { tenantNegotiation, type ContinuationDeps } from '#/view/routes/continuation';
import { type AuthorizationErrorCode } from '#/service/oauth-errors';

// RFC 6749 §4.1.2.1 / OIDC Core §3.1.2.6: `access_denied`, since the sign-in
// was not completed and nothing was granted. `login_required` is defined for
// a request that forbids interaction, which this was not.
const NOT_COMPLETED: AuthorizationErrorCode = 'access_denied';

// A request the restart link cannot rebuild faithfully (one tied to a
// subject by a hint) can still be handed back to the application, which
// restarts it with a hint of its own. Only to a redirect_uri the client
// still registers: the one /authorize validated may have been removed since.
async function returnToApplication(
  reply: FastifyReply,
  deps: ContinuationDeps,
  tenantId: string,
  pending: PendingRequest,
  actionFailed = false,
): Promise<WayOn | undefined> {
  if (!(await deps.redirectStillRegistered(tenantId, pending.clientId, pending.redirectUri))) {
    return undefined;
  }
  return { kind: 'return', href: returnHref(reply, pending, actionFailed) };
}

// Back to the client with the refusal, and, where an action was asked for and
// has not ended, the word that it did not complete.
function returnHref(reply: FastifyReply, pending: PendingRequest, actionFailed: boolean): string {
  const href = errorRedirect(pending, tenantAddressOf(reply.request), NOT_COMPLETED);
  if (!actionFailed && requestedActionOf(pending) === null) return href;
  const target = new URL(href);
  target.searchParams.set('action_status', 'error');
  return target.toString();
}

// An action an application asked for that this person's account cannot take:
// recorded as failed, and the page says so and offers the way back.
export async function sendActionUnavailable(
  reply: FastifyReply,
  deps: ContinuationDeps,
  tenantName: string,
  authSessionId: string,
): Promise<FastifyReply> {
  const tenant = await deps.findTenant(tenantName);
  const pending = tenant === null ? null : await deps.loadPendingRequest(tenant.id, authSessionId);
  const wayOn =
    tenant === null || pending === null
      ? undefined
      : await returnToApplication(reply, deps, tenant.id, pending, true);
  const locale = await brandLocale(
    withPageTheme(
      negotiatePageLocale({
        uiLocales: pending?.uiLocales ?? [],
        acceptLanguage: reply.request.headers['accept-language'],
        ...tenantNegotiation(tenant),
      }),
      reply.request.headers.cookie,
    ),
    deps.resolveBranding,
    tenant === null
      ? null
      : { tenantId: tenant.id, tenantName, clientId: pending?.clientId ?? null },
    deps.resolveOverrides,
  );
  return sendHtml(
    reply,
    400,
    renderAuthorizeErrorPage('access_denied', t(locale, 'error.actionUnavailable'), wayOn, locale),
  );
}

// The one answer for a submission whose authentication session is no longer
// usable. The row may still exist — it lives until the reaper deletes it —
// and then it is read only to rebuild a link: to /authorize when the request
// can be rebuilt, else back to the client. It authenticates nothing. With no
// row the page offers no link.
export async function sendSignInExpired(
  reply: FastifyReply,
  deps: ContinuationDeps,
  tenantName: string,
  authSessionId: string | undefined,
): Promise<FastifyReply> {
  const tenant = await deps.findTenant(tenantName);
  const pending =
    tenant === null || authSessionId === undefined
      ? null
      : await deps.recoverPendingRequest(tenant.id, authSessionId);
  let wayOn: WayOn | undefined;
  if (tenant !== null && pending !== null) {
    const restart = restartAuthorizeLocation(tenantAddressOf(reply.request), pending);
    wayOn =
      restart === null
        ? await returnToApplication(reply, deps, tenant.id, pending)
        : { kind: 'restart', href: restart };
  }
  // The row may be gone, and an expired attempt authenticated nobody, so
  // the page is in the language its parked request asked for when there is
  // one, and the browser's otherwise.
  const locale = await brandLocale(
    withPageTheme(
      negotiatePageLocale({
        uiLocales: pending?.uiLocales ?? [],
        acceptLanguage: reply.request.headers['accept-language'],
        ...tenantNegotiation(tenant),
      }),
      reply.request.headers.cookie,
    ),
    deps.resolveBranding,
    tenant === null
      ? null
      : { tenantId: tenant.id, tenantName, clientId: pending?.clientId ?? null },
    deps.resolveOverrides,
  );
  return sendHtml(
    reply,
    400,
    renderAuthorizeErrorPage('invalid_request', t(locale, 'error.signInExpired'), wayOn, locale),
  );
}
