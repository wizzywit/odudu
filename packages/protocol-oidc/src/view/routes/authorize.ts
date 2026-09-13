import { type FastifyInstance, type FastifyReply } from 'fastify';
import { FORM_MEDIA_TYPE } from '#/service/media-type';
import {
  handleAuthorizationRequest,
  type AuthorizeUsecaseDeps,
} from '#/usecase/authorization-request';
import { renderAuthorizeErrorPage, renderLoginForm } from '#/view/authorize-html';
import { sendHtml } from '#/view/html-response';
import { realmIssuerFor } from '#/view/issuer';
import { namesUnsupportedRepresentation } from '#/view/media-type';

const PATH = '/realms/:realm/protocol/openid-connect/auth';

// OIDC Core §3.1.2 requires both methods; they differ only in where the
// parameters come from, and share everything after, so they cannot drift
// out of agreement — down to a POST naming no representation answering
// exactly as a GET with no query parameters does. Parameters arrive as
// `unknown` because that is the truth: they are whatever a body parser
// produced, and normalizeAuthorizeQuery turns them back into strings.
async function respondToAuthorizationRequest(
  deps: AuthorizeUsecaseDeps,
  realm: string,
  params: unknown,
  issuer: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const outcome = await handleAuthorizationRequest(deps, realm, params, issuer);

  if (outcome.kind === 'render') {
    return sendHtml(reply, 400, renderAuthorizeErrorPage(outcome.error, outcome.description));
  }

  if (outcome.kind === 'redirect') {
    const target = new URL(outcome.redirectUri);
    target.searchParams.set('error', outcome.error);
    if (outcome.state !== null) target.searchParams.set('state', outcome.state);
    // RFC 9207 §2: every authorization response names the issuer, error
    // responses included — a client that cannot tell which server failed
    // its request is exactly the client a mix-up attack preys on.
    target.searchParams.set('iss', issuer);
    return reply.code(302).header('location', target.toString()).send();
  }

  return sendHtml(reply, 200, renderLoginForm(realm, outcome.authSessionId));
}

export function registerAuthorizeRoute(app: FastifyInstance, deps: AuthorizeUsecaseDeps): void {
  app.get<{ Params: { realm: string } }>(PATH, (request, reply) =>
    respondToAuthorizationRequest(
      deps,
      request.params.realm,
      request.query,
      realmIssuerFor(request, request.params.realm),
      reply,
    ),
  );

  // OIDC Core §3.1.2.1 fixes the POST representation: form serialized. Any
  // other media type is an unsupported representation rather than a
  // malformed authorization request, refused with 415 before any parser
  // runs — nothing is parsed, so no redirect_uri has been established to
  // trust and there is nowhere to redirect an error to. The test is the
  // media type, not whether a body arrived (see media-type.ts): an empty
  // JSON request names the same unsupported representation a full one does.
  app.post<{ Params: { realm: string } }>(
    PATH,
    {
      onRequest: async (request, reply) => {
        if (namesUnsupportedRepresentation(request)) {
          await sendHtml(
            reply,
            415,
            renderAuthorizeErrorPage(
              'invalid_request',
              `Authorization request parameters must be sent as ${FORM_MEDIA_TYPE}.`,
            ),
          );
        }
      },
    },
    (request, reply) =>
      respondToAuthorizationRequest(
        deps,
        request.params.realm,
        request.body,
        realmIssuerFor(request, request.params.realm),
        reply,
      ),
  );
}
