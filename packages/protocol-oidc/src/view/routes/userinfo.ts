import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { FORM_MEDIA_TYPE } from '#/service/media-type';
import { resolveUserinfo, type UserinfoDeps } from '#/usecase/userinfo';
import { realmIssuerFor } from '#/view/issuer';
import { namesUnsupportedRepresentation } from '#/view/media-type';

const PATH = '/realms/:realm/protocol/openid-connect/userinfo';

const CHALLENGE = 'Bearer realm="userinfo"';

async function respondToUserinfoRequest(
  deps: UserinfoDeps,
  request: FastifyRequest<{ Params: { realm: string } }>,
  body: unknown,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const issuer = realmIssuerFor(request, request.params.realm);
  const outcome = await resolveUserinfo(
    deps,
    request.params.realm,
    issuer,
    request.headers.authorization,
    body,
  );

  switch (outcome.kind) {
    case 'not_found':
      return reply.code(404).send();
    case 'missing_credentials':
      return reply.code(401).header('www-authenticate', CHALLENGE).send();
    case 'invalid_request':
      return reply
        .code(400)
        .header('www-authenticate', `${CHALLENGE}, error="invalid_request"`)
        .send();
    case 'invalid_token':
      return reply
        .code(401)
        .header('www-authenticate', `${CHALLENGE}, error="invalid_token"`)
        .send();
    case 'insufficient_scope':
      return reply
        .code(403)
        .header('www-authenticate', `${CHALLENGE}, error="insufficient_scope"`)
        .send();
    case 'ok':
      return reply.code(200).send(outcome.claims);
  }
}

export function registerUserinfoRoute(app: FastifyInstance, deps: UserinfoDeps): void {
  // OIDC Core §5.3 requires both methods. A GET has no body to read a token
  // from, so the two differ only in what they hand the resolver; everything
  // after that is one path.
  app.get<{ Params: { realm: string } }>(PATH, (request, reply) =>
    respondToUserinfoRequest(deps, request, undefined, reply),
  );

  // RFC 6750 §2.2 fixes the form-encoded body method's content type. Any
  // other media type is an unsupported representation rather than a bad
  // token, so it is refused with 415 (RFC 9110 §15.5.16) before a parser
  // runs — the same rule `/authorize` applies, sharing one media-type test
  // with it. A POST naming no content type and carrying no body carries no
  // representation to refuse: it is a request whose only credential is the
  // Authorization header, and is answered like one.
  //
  // Unlike `/authorize`, the refusal has no body: this endpoint answers a
  // machine in JSON and reports every other failure in headers alone.
  app.post<{ Params: { realm: string } }>(
    PATH,
    {
      onRequest: async (request, reply) => {
        if (namesUnsupportedRepresentation(request)) {
          await reply.code(415).header('accept-post', FORM_MEDIA_TYPE).send();
        }
      },
    },
    (request, reply) => respondToUserinfoRequest(deps, request, request.body, reply),
  );
}
