import { clearedSessionCookies } from '@odudu/authn-flows';
import { type RenderedPage } from '@odudu/kernel';
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
  renderLogoutConfirmationPage,
  renderLogoutRedirectRefusedPage,
  renderLogoutUnauthenticatedPage,
  renderNoActiveSessionPage,
} from '#/view/logout-html';
import { sendHtml } from '#/view/html-response';
import { realmIssuerFor } from '#/view/issuer';

const PATH = '/realms/:realm/protocol/openid-connect/logout';

export interface LogoutRouteDeps extends LogoutUsecaseDeps {
  tls: boolean;
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

// Every page this route renders carries a live SSO session identifier
// (the confirmation form's hidden `session_id`) or exists only because one
// was just ended — neither belongs in a shared or history cache.
function sendLogoutHtml(reply: FastifyReply, status: number, page: RenderedPage): FastifyReply {
  reply.header('cache-control', 'no-store');
  return sendHtml(reply, status, page);
}

async function respondToOutcome(
  outcome: LogoutOutcome,
  realm: string,
  tls: boolean,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (outcome.kind === 'not_found') {
    return reply.code(404).send();
  }

  if (outcome.kind === 'unauthenticated') {
    return sendLogoutHtml(reply, 400, renderLogoutUnauthenticatedPage());
  }

  if (outcome.kind === 'confirm') {
    if (outcome.sessionId === null) {
      return sendLogoutHtml(reply, 200, renderNoActiveSessionPage());
    }
    return sendLogoutHtml(
      reply,
      200,
      renderLogoutConfirmationPage(realm, outcome.sessionId, {
        clientId: outcome.clientId,
        postLogoutRedirectUri: outcome.postLogoutRedirectUri,
        state: outcome.state,
      }),
    );
  }

  // Both remaining outcomes end here having already ended a session — the
  // `render` outcome always does (decideLogout only refuses a redirect on
  // the branch that first confirmed a session), and `end` only when its own
  // `sessionEnded` says so (decideLogout can also honour a matched redirect
  // with no session to end at all).
  const sessionEnded = outcome.kind === 'render' || outcome.sessionEnded;
  if (sessionEnded) {
    for (const cookie of clearedSessionCookies(realm, tls)) {
      reply.header('set-cookie', cookie);
    }
  }

  if (outcome.kind === 'render') {
    return sendLogoutHtml(
      reply,
      400,
      renderLogoutRedirectRefusedPage(outcome.frontChannelLogoutUrls),
    );
  }

  // RP-Initiated Logout §3's redirect, carrying state the same way RFC
  // 9207 has /authorize carry iss on every response — this is not an
  // authorization response, so no `iss` parameter of its own applies here.
  if (outcome.redirectTo === null) {
    return sendLogoutHtml(reply, 200, renderLoggedOutPage(outcome.frontChannelLogoutUrls));
  }
  const target = new URL(outcome.redirectTo);
  if (outcome.state !== null) target.searchParams.set('state', outcome.state);
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
  deps: LogoutRouteDeps,
  request: FastifyRequest<{ Params: { realm: string } }>,
  reply: FastifyReply,
  params: LogoutRequestParams,
): Promise<FastifyReply> {
  const realm = request.params.realm;
  const outcome = await handleLogoutRequest(
    deps,
    realm,
    realmIssuerFor(request, realm),
    request.headers.cookie,
    params,
  );
  return respondToOutcome(outcome, realm, deps.tls, reply);
}

export function registerLogoutRoute(app: FastifyInstance, deps: LogoutRouteDeps): void {
  app.get<{
    Params: { realm: string };
    Querystring: Record<string, string | undefined>;
  }>(PATH, async (request, reply) =>
    respondToLogoutRequest(deps, request, reply, logoutRequestParams(request.query)),
  );

  app.post<{
    Params: { realm: string };
    Body: Record<string, string | string[] | undefined>;
  }>(PATH, async (request, reply) => {
    const body = request.body;
    const confirmedSessionId = firstString(body.session_id);
    // No `session_id` is not a malformed confirmation: it is a logout
    // request an RP Form-Serialized into a body rather than a query string,
    // which §2 requires the endpoint to answer exactly as it answers `GET`.
    // The field is the confirmation form's own, and only the form sends it.
    if (confirmedSessionId === undefined) {
      return respondToLogoutRequest(deps, request, reply, logoutRequestParams(body));
    }

    const outcome = await handleLogoutConfirmation(
      deps,
      request.params.realm,
      realmIssuerFor(request, request.params.realm),
      request.headers.cookie,
      {
        confirmedSessionId,
        clientId: firstString(body.client_id) ?? null,
        postLogoutRedirectUri: firstString(body.post_logout_redirect_uri) ?? null,
        state: firstString(body.state) ?? null,
      },
    );
    return respondToOutcome(outcome, request.params.realm, deps.tls, reply);
  });
}
