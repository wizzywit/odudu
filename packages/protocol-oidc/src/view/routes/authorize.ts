import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import {
  handleAuthorizationRequest,
  type AuthorizeUsecaseDeps,
} from '#/usecase/authorization-request';
import { renderAuthorizeErrorPage, renderLoginForm } from '#/view/authorize-html';

const PATH = '/realms/:realm/protocol/openid-connect/auth';

// GET carries parameters in the query string, POST in a form-encoded body
// (OIDC Core §3.1.2 requires the Authorization Endpoint to support both) —
// but everything past "where do the parameters come from" is one shared
// path, so the two methods cannot drift out of agreement with each other,
// down to a POST with no body answering exactly as a GET with no query
// parameters does.
const FORM_MEDIA_TYPE = 'application/x-www-form-urlencoded';

function isFormEncoded(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const [mediaType] = contentType.split(';');
  return mediaType?.trim().toLowerCase() === FORM_MEDIA_TYPE;
}

// A POST with no body is a request carrying no parameters, which is a
// perfectly ordinary (invalid) authorization request and must answer like
// one; only a body that is actually there has a representation to reject.
function carriesBody(request: FastifyRequest): boolean {
  const length = request.headers['content-length'];
  if (request.headers['transfer-encoding'] !== undefined) return true;
  return length !== undefined && length !== '0';
}

// Parameters reach the handler as `unknown` because that is the truth: they
// are whatever a body parser produced. normalizeAuthorizeQuery is what turns
// them back into strings.
async function respondToAuthorizationRequest(
  deps: AuthorizeUsecaseDeps,
  realm: string,
  params: unknown,
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
    return reply.code(302).header('location', target.toString()).send();
  }

  return reply.code(200).type('text/html').send(renderLoginForm(realm, outcome.authSessionId));
}

export function registerAuthorizeRoute(app: FastifyInstance, deps: AuthorizeUsecaseDeps): void {
  app.get<{ Params: { realm: string } }>(PATH, (request, reply) =>
    respondToAuthorizationRequest(deps, request.params.realm, request.query, reply),
  );

  // OIDC Core §3.1.2.1 fixes the POST representation: the parameters are
  // form serialized. A body in any other media type is an unsupported
  // representation rather than a malformed authorization request, so it is
  // refused with 415 (RFC 9110 §15.5.16) before any parser runs — the
  // request is never parsed, so no redirect_uri has been established to
  // trust, and there is nowhere to redirect an error to either.
  app.post<{ Params: { realm: string } }>(
    PATH,
    {
      onRequest: async (request, reply) => {
        if (carriesBody(request) && !isFormEncoded(request.headers['content-type'])) {
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
      respondToAuthorizationRequest(deps, request.params.realm, request.body, reply),
  );
}
