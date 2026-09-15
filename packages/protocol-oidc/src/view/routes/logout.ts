import { sessionCookieName } from '@odudu/authn-flows';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  handleLogoutConfirmation,
  handleLogoutRequest,
  type LogoutOutcome,
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

// Duplicated from routes/authorize.ts rather than shared: the cookie is
// read here and nowhere else on this path, so the usecase never has a
// request to reach for any other header from.
function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

async function respondToOutcome(
  outcome: LogoutOutcome,
  realm: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (outcome.kind === 'not_found') {
    return reply.code(404).send();
  }

  if (outcome.kind === 'unauthenticated') {
    return sendHtml(reply, 400, renderLogoutUnauthenticatedPage());
  }

  if (outcome.kind === 'confirm') {
    if (outcome.sessionId === null) {
      return sendHtml(reply, 200, renderNoActiveSessionPage());
    }
    return sendHtml(
      reply,
      200,
      renderLogoutConfirmationPage(realm, outcome.sessionId, {
        clientId: outcome.clientId,
        postLogoutRedirectUri: outcome.postLogoutRedirectUri,
        state: outcome.state,
      }),
    );
  }

  if (outcome.kind === 'render') {
    return sendHtml(reply, 400, renderLogoutRedirectRefusedPage());
  }

  // `end`: RP-Initiated Logout §3's redirect, carrying state the same way
  // RFC 9207 has /authorize carry iss on every response — this is not an
  // authorization response, so no `iss` parameter of its own applies here.
  if (outcome.redirectTo === null) {
    return sendHtml(reply, 200, renderLoggedOutPage());
  }
  const target = new URL(outcome.redirectTo);
  if (outcome.state !== null) target.searchParams.set('state', outcome.state);
  return reply.code(302).header('location', target.toString()).send();
}

export function registerLogoutRoute(app: FastifyInstance, deps: LogoutRouteDeps): void {
  app.get<{
    Params: { realm: string };
    Querystring: Record<string, string | undefined>;
  }>(PATH, async (request, reply) => {
    const outcome = await handleLogoutRequest(
      deps,
      request.params.realm,
      realmIssuerFor(request, request.params.realm),
      readCookie(request, sessionCookieName(request.params.realm, deps.tls)),
      {
        idTokenHint: request.query.id_token_hint ?? null,
        clientId: request.query.client_id ?? null,
        postLogoutRedirectUri: request.query.post_logout_redirect_uri ?? null,
        state: request.query.state ?? null,
      },
    );
    return respondToOutcome(outcome, request.params.realm, reply);
  });

  app.post<{
    Params: { realm: string };
    Body: Record<string, string | string[] | undefined>;
  }>(PATH, async (request, reply) => {
    const body = request.body;
    const confirmedSessionId = firstString(body.session_id);
    if (confirmedSessionId === undefined) {
      return sendHtml(reply, 400, renderLogoutUnauthenticatedPage());
    }

    const outcome = await handleLogoutConfirmation(
      deps,
      request.params.realm,
      readCookie(request, sessionCookieName(request.params.realm, deps.tls)),
      {
        confirmedSessionId,
        clientId: firstString(body.client_id) ?? null,
        postLogoutRedirectUri: firstString(body.post_logout_redirect_uri) ?? null,
        state: firstString(body.state) ?? null,
      },
    );
    return respondToOutcome(outcome, request.params.realm, reply);
  });
}
