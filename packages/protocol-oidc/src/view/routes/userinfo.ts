import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { corsHeadersForRequest } from '#/service/cors';
import { FORM_MEDIA_TYPE } from '#/service/media-type';
import { resolveUserinfo, type UserinfoDeps, type UserinfoOutcome } from '#/usecase/userinfo';
import { realmIssuerFor } from '#/view/issuer';
import { namesUnsupportedRepresentation } from '#/view/media-type';

const PATH = '/realms/:realm/protocol/openid-connect/userinfo';

const CHALLENGE = 'Bearer realm="userinfo"';

// The client behind the request is known only once the access token
// verifies (`ok`, `insufficient_scope`); every earlier outcome — no
// realm, no credentials, an unparseable or invalid token — has no client
// to check the origin against, so the header is withheld the same way an
// origin outside that client's own list would be.
async function corsHeadersFor(
  deps: UserinfoDeps,
  request: FastifyRequest<{ Params: { realm: string } }>,
  outcome: UserinfoOutcome,
): Promise<Record<string, string>> {
  const clientId =
    outcome.kind === 'ok' ||
    outcome.kind === 'insufficient_scope' ||
    outcome.kind === 'signing_unavailable'
      ? outcome.clientId
      : undefined;
  if (clientId === undefined) return corsHeadersForRequest(request.headers.origin, new Set());

  const realm = await deps.findRealm(request.params.realm);
  const allowed =
    realm === null ? new Set<string>() : await deps.resolveClientWebOrigins(realm.id, clientId);
  return corsHeadersForRequest(request.headers.origin, allowed);
}

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
  const corsHeaders = await corsHeadersFor(deps, request, outcome);

  switch (outcome.kind) {
    case 'not_found':
      return reply.headers(corsHeaders).code(404).send();
    case 'missing_credentials':
      return reply.headers(corsHeaders).code(401).header('www-authenticate', CHALLENGE).send();
    case 'invalid_request':
      return reply
        .headers(corsHeaders)
        .code(400)
        .header('www-authenticate', `${CHALLENGE}, error="invalid_request"`)
        .send();
    case 'invalid_token':
      return reply
        .headers(corsHeaders)
        .code(401)
        .header('www-authenticate', `${CHALLENGE}, error="invalid_token"`)
        .send();
    case 'insufficient_scope':
      return reply
        .headers(corsHeaders)
        .code(403)
        .header('www-authenticate', `${CHALLENGE}, error="insufficient_scope"`)
        .send();
    // Not a bad-token failure (RFC 6750 §3's own vocabulary), so no
    // `WWW-Authenticate` challenge — the presented access token is fine.
    // No body either: the reason is a realm/client configuration state an
    // operator reads from `/userinfo`'s own logs, not text for the caller.
    case 'signing_unavailable':
      return reply.headers(corsHeaders).code(500).send();
    case 'ok':
      if (outcome.body.kind === 'jwt') {
        return reply
          .headers(corsHeaders)
          .code(200)
          .header('content-type', 'application/jwt')
          .send(outcome.body.token);
      }
      return reply.headers(corsHeaders).code(200).send(outcome.body.claims);
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
  // token, refused with 415 before a parser runs — the same rule
  // `/authorize` applies, through the same media-type test. Unlike
  // `/authorize`, the refusal has no body: this endpoint answers a machine
  // in JSON and reports every other failure in headers alone.
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
