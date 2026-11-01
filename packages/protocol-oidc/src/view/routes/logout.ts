import { clearedSessionCookies } from '@odudu/authn-flows';
import { requestContextFrom } from '@odudu/domain-audit';
import { type BrandingResolver, type OverridesResolver, type PageLocale } from '@odudu/kernel';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  handleLogoutConfirmation,
  handleLogoutRequest,
  type LogoutOutcome,
  type LogoutRequestParams,
  type LogoutUsecaseDeps,
} from '#/usecase/logout';
import {
  renderLoggedOutPage,
  renderLoggedOutRedirectPage,
  renderLogoutConfirmationPage,
  renderLogoutRedirectRefusedPage,
  renderLogoutUnauthenticatedPage,
  renderNoActiveSessionPage,
} from '#/view/logout-html';
import { sendHtml } from '#/view/html-response';
import {
  brandedRequestLocale,
  lookingUpTenantOnce,
  type ContinuationDeps,
} from '#/view/routes/continuation';
import { tenantIssuerFor } from '#/view/issuer';

const PATH = '/tenants/:tenant/protocol/openid-connect/logout';

export interface LogoutRouteDeps extends LogoutUsecaseDeps {
  tls: boolean;
  resolveBranding?: BrandingResolver;
  resolveOverrides?: OverridesResolver;
}

// A parameter sent twice arrives as an array, and is dropped rather than
// read first-wins: "which one did it mean" has no answer a client can rely
// on, and every caller here fails safe on `undefined` — a repeated
// `session_id` takes the stricter request path, a repeated `id_token_hint`
// leaves the End-User to confirm. The name says "first" because that is
// the shape it narrows to, not because it picks one out of several.
function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function respondToOutcome(
  outcome: LogoutOutcome,
  tenant: string,
  tls: boolean,
  reply: FastifyReply,
  deps: Pick<ContinuationDeps, 'findTenant' | 'resolveBranding' | 'resolveOverrides'>,
): Promise<FastifyReply> {
  // Asked for only by a branch that renders a page: a redirect has none. A
  // client's theme is worn only where the outcome says a hint verified it.
  const locale = (clientId: string | null = null): Promise<PageLocale> =>
    brandedRequestLocale(deps, reply, tenant, clientId);
  if (outcome.kind === 'not_found') {
    return reply.code(404).send();
  }

  if (outcome.kind === 'unauthenticated') {
    return sendHtml(reply, 400, renderLogoutUnauthenticatedPage(await locale()));
  }

  if (outcome.kind === 'confirm') {
    if (outcome.sessionId === null || outcome.csrf === null) {
      return sendHtml(reply, 200, renderNoActiveSessionPage(await locale(outcome.brandClientId)));
    }
    const page = renderLogoutConfirmationPage(
      tenant,
      outcome.sessionId,
      outcome.csrf,
      {
        clientId: outcome.clientId,
        postLogoutRedirectUri: outcome.postLogoutRedirectUri,
        state: outcome.state,
      },
      await locale(outcome.brandClientId),
    );
    return sendHtml(
      reply,
      200,
      outcome.registeredRedirect === null
        ? page
        : { ...page, redirectsTo: outcome.registeredRedirect },
    );
  }

  // Both remaining outcomes end here having already ended a session — the
  // `render` outcome always does (a redirect is refused only after the
  // session ended), and `end` only when its own `sessionEnded` says so
  // (decideLogout can also honour a matched redirect with no session to end
  // at all).
  const sessionEnded = outcome.kind === 'render' || outcome.sessionEnded;
  if (sessionEnded) {
    for (const cookie of clearedSessionCookies(tenant, tls)) {
      reply.header('set-cookie', cookie);
    }
  }

  if (outcome.kind === 'render') {
    return sendHtml(
      reply,
      400,
      renderLogoutRedirectRefusedPage(
        outcome.frontChannelLogoutUrls,
        await locale(outcome.brandClientId),
      ),
    );
  }

  // RP-Initiated Logout §3's redirect, carrying state the same way RFC
  // 9207 has /authorize carry iss on every response — this is not an
  // authorization response, so no `iss` parameter of its own applies here.
  if (outcome.redirectTo === null) {
    return sendHtml(
      reply,
      200,
      renderLoggedOutPage(outcome.frontChannelLogoutUrls, await locale(outcome.brandClientId)),
    );
  }
  const target = new URL(outcome.redirectTo);
  if (outcome.state !== null) target.searchParams.set('state', outcome.state);
  if (outcome.frontChannelLogoutUrls.length > 0) {
    return sendHtml(
      reply,
      200,
      renderLoggedOutRedirectPage(
        outcome.frontChannelLogoutUrls,
        target.toString(),
        await locale(outcome.brandClientId),
      ),
    );
  }
  reply.header('cache-control', 'no-store');
  return reply.code(302).header('location', target.toString()).send();
}

// §2 defines these four for the logout request itself, and requires both
// HTTP methods at the endpoint: a `GET` serializes them into the query
// string, a `POST` into a form body. Read through one function so the two
// methods cannot drift into answering the same request differently.
function logoutRequestParams(
  source: Record<string, string | string[] | undefined>,
): LogoutRequestParams {
  return {
    idTokenHint: firstString(source.id_token_hint) ?? null,
    clientId: firstString(source.client_id) ?? null,
    postLogoutRedirectUri: firstString(source.post_logout_redirect_uri) ?? null,
    state: firstString(source.state) ?? null,
  };
}

async function respondToLogoutRequest(
  routeDeps: LogoutRouteDeps,
  request: FastifyRequest<{ Params: { tenant: string } }>,
  reply: FastifyReply,
  params: LogoutRequestParams,
): Promise<FastifyReply> {
  const tenant = request.params.tenant;
  const deps = lookingUpTenantOnce(routeDeps);
  const outcome = await handleLogoutRequest(
    deps,
    tenant,
    tenantIssuerFor(request, tenant),
    request.headers.cookie,
    params,
    requestContextFrom(request),
  );
  return respondToOutcome(outcome, tenant, deps.tls, reply, deps);
}

export function registerLogoutRoute(app: FastifyInstance, routeDeps: LogoutRouteDeps): void {
  app.get<{
    Params: { tenant: string };
    Querystring: Record<string, string | undefined>;
  }>(PATH, async (request, reply) =>
    respondToLogoutRequest(routeDeps, request, reply, logoutRequestParams(request.query)),
  );

  app.post<{
    Params: { tenant: string };
    Body: Record<string, string | string[] | undefined>;
  }>(PATH, async (request, reply) => {
    const body = request.body;
    const confirmedSessionId = firstString(body.session_id);
    // No `session_id` is not a malformed confirmation: it is a logout
    // request an RP Form-Serialized into a body rather than a query string,
    // which §2 requires the endpoint to answer exactly as it answers `GET`.
    // The field is the confirmation form's own, and only the form sends it.
    if (confirmedSessionId === undefined) {
      return respondToLogoutRequest(routeDeps, request, reply, logoutRequestParams(body));
    }

    const deps = lookingUpTenantOnce(routeDeps);
    const outcome = await handleLogoutConfirmation(
      deps,
      request.params.tenant,
      tenantIssuerFor(request, request.params.tenant),
      request.headers.cookie,
      {
        confirmedSessionId,
        csrf: firstString(body.csrf) ?? '',
        clientId: firstString(body.client_id) ?? null,
        postLogoutRedirectUri: firstString(body.post_logout_redirect_uri) ?? null,
        state: firstString(body.state) ?? null,
      },
      requestContextFrom(request),
    );
    return respondToOutcome(outcome, request.params.tenant, deps.tls, reply, deps);
  });
}
