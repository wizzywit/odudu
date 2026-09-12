import { type FastifyInstance, type FastifyReply } from 'fastify';
import {
  handleAuthorizationRequest,
  type AuthorizeUsecaseDeps,
} from '#/usecase/authorization-request';
import { renderAuthorizeErrorPage, renderLoginForm } from '#/view/authorize-html';
import { realmIssuerFor } from '#/view/issuer';

const PATH = '/realms/:realm/protocol/openid-connect/auth';

// GET carries parameters in the query string, POST in a form-encoded body
// (OIDC Core §3.1.2 requires the Authorization Endpoint to support both) —
// but everything past "where do the parameters come from" is one shared
// path, so the two methods cannot drift out of agreement with each other,
// down to a POST naming no representation at all answering exactly as a
// GET with no query parameters does.
const FORM_MEDIA_TYPE = 'application/x-www-form-urlencoded';

function isFormEncoded(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const [mediaType] = contentType.split(';');
  return mediaType?.trim().toLowerCase() === FORM_MEDIA_TYPE;
}

// Parameters reach the handler as `unknown` because that is the truth: they
// are whatever a body parser produced. normalizeAuthorizeQuery is what turns
// them back into strings.
async function respondToAuthorizationRequest(
  deps: AuthorizeUsecaseDeps,
  realm: string,
  params: unknown,
  issuer: string,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const outcome = await handleAuthorizationRequest(deps, realm, params);

  if (outcome.kind === 'render') {
    return reply
      .code(400)
      .type('text/html')
      .send(renderAuthorizeErrorPage(outcome.error, outcome.description));
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

  return reply.code(200).type('text/html').send(renderLoginForm(realm, outcome.authSessionId));
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

  // OIDC Core §3.1.2.1 fixes the POST representation: the parameters are
  // form serialized. Any other media type is an unsupported representation
  // rather than a malformed authorization request, so it is refused with
  // 415 (RFC 9110 §15.5.16) before any parser runs — the request is never
  // parsed, so no redirect_uri has been established to trust, and there is
  // nowhere to redirect an error to either.
  //
  // The test is the media type, not whether a body arrived: an empty JSON
  // request names the same unsupported representation a full one does, and
  // keying on the body instead handed it to Fastify's JSON parser, which
  // answered a different status in a different media type for what is the
  // same refusal. A request naming no content type at all carries no
  // representation to refuse and is simply a request with no parameters.
  app.post<{ Params: { realm: string } }>(
    PATH,
    {
      onRequest: async (request, reply) => {
        const contentType = request.headers['content-type'];
        if (contentType !== undefined && !isFormEncoded(contentType)) {
          await reply
            .code(415)
            .type('text/html')
            .send(
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
