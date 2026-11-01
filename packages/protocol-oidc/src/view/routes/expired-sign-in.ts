import { type PendingRequest } from '@odudu/authn-flows';
import { negotiatePageLocale } from '@odudu/i18n';
import { brandLocale, withPageTheme } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';
import { restartAuthorizeLocation } from '#/service/restart-request';
import { errorRedirect } from '#/usecase/login-submission';
import { renderAuthorizeErrorPage, type WayOn } from '#/view/authorize-html';
import { sendHtml } from '#/view/html-response';
import { t } from '#/view/messages';
import { tenantNegotiation, type ContinuationDeps } from '#/view/routes/continuation';
import { issuerBaseFor } from '#/view/issuer';
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
  tenantName: string,
  pending: PendingRequest,
): Promise<WayOn | undefined> {
  if (!(await deps.redirectStillRegistered(tenantId, pending.clientId, pending.redirectUri))) {
    return undefined;
  }
  return {
    kind: 'return',
    href: errorRedirect(pending, tenantName, issuerBaseFor(reply.request), NOT_COMPLETED),
  };
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
    const restart = restartAuthorizeLocation(tenantName, pending);
    wayOn =
      restart === null
        ? await returnToApplication(reply, deps, tenant.id, tenantName, pending)
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
