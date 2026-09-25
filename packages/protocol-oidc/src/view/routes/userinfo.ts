import { type Clock, systemClock } from '@odudu/kernel';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { corsHeadersForRequest } from '#/service/cors';
import { FORM_MEDIA_TYPE } from '#/service/media-type';
import { resolveUserinfo, type UserinfoDeps, type UserinfoOutcome } from '#/usecase/userinfo';
import { tenantIssuerFor } from '#/view/issuer';
import { namesUnsupportedRepresentation } from '#/view/media-type';

const PATH = '/tenants/:tenant/protocol/openid-connect/userinfo';

// `realm` is RFC 7235 §4.1's auth-param name, not this project's word.
const CHALLENGE = 'Bearer realm="userinfo"';

// The client behind the request is known once the access token's
// signature verifies — `ok`, `insufficient_scope`, `signing_unavailable`,
// `encryption_unavailable`, and now `invalid_token` too, whenever the
// refusal comes from something the payload said (a missing `sub`, an
// unknown `grant_id`, a revoked grant, a dead session) rather than from
// the signature itself. Every outcome before that point has no client to
// check the origin against, so the header is withheld the same way an
// origin outside that client's own list would be.
async function corsHeadersFor(
  deps: UserinfoDeps,
  request: FastifyRequest<{ Params: { tenant: string } }>,
  outcome: UserinfoOutcome,
): Promise<Record<string, string>> {
  const clientId =
    outcome.kind === 'ok' ||
    outcome.kind === 'insufficient_scope' ||
    outcome.kind === 'signing_unavailable' ||
    outcome.kind === 'encryption_unavailable' ||
    outcome.kind === 'invalid_token'
      ? outcome.clientId
      : undefined;
  if (clientId === undefined) return corsHeadersForRequest(request.headers.origin, new Set());

  const tenant = await deps.findTenant(request.params.tenant);
  const allowed =
    tenant === null ? new Set<string>() : await deps.resolveClientWebOrigins(tenant.id, clientId);
  return corsHeadersForRequest(request.headers.origin, allowed);
}

async function respondToUserinfoRequest(
  deps: UserinfoDeps,
  clock: Clock,
  request: FastifyRequest<{ Params: { tenant: string } }>,
  body: unknown,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const issuer = tenantIssuerFor(request, request.params.tenant);
  const outcome = await resolveUserinfo(
    deps,
    request.params.tenant,
    issuer,
    request.headers.authorization,
    body,
    clock.now(),
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
    // Not the token's fault, so no `WWW-Authenticate` challenge; no body
    // either — logged below instead, for whoever operates this tenant.
    case 'signing_unavailable':
      request.log.warn(
        {
          client_id: outcome.clientId,
          userinfo_signed_response_alg: outcome.registeredAlg,
          signing_keys_available: outcome.availableAlgs,
        },
        'userinfo: no signing key produces the registered algorithm',
      );
      return reply.headers(corsHeaders).code(500).send();
    // Same shape as signing_unavailable, for the same reason (see
    // `encryption_unavailable` on `UserinfoOutcome`).
    case 'encryption_unavailable':
      request.log.warn(
        { client_id: outcome.clientId, reason: outcome.reason },
        'userinfo: could not encrypt the response for the registered client',
      );
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

export interface UserinfoRouteDeps extends UserinfoDeps {
  clock?: Clock;
}

export function registerUserinfoRoute(app: FastifyInstance, deps: UserinfoRouteDeps): void {
  const clock = deps.clock ?? systemClock;

  // OIDC Core §5.3 requires both methods. A GET has no body to read a token
  // from, so the two differ only in what they hand the resolver; everything
  // after that is one path.
  app.get<{ Params: { tenant: string } }>(PATH, (request, reply) =>
    respondToUserinfoRequest(deps, clock, request, undefined, reply),
  );

  // RFC 6750 §2.2 fixes the form-encoded body method's content type. Any
  // other media type is an unsupported representation rather than a bad
  // token, refused with 415 before a parser runs — the same rule
  // `/authorize` applies, through the same media-type test. Unlike
  // `/authorize`, the refusal has no body: this endpoint answers a machine
  // in JSON and reports every other failure in headers alone.
  app.post<{ Params: { tenant: string } }>(
    PATH,
    {
      onRequest: async (request, reply) => {
        if (namesUnsupportedRepresentation(request)) {
          await reply.code(415).header('accept-post', FORM_MEDIA_TYPE).send();
        }
      },
    },
    (request, reply) => respondToUserinfoRequest(deps, clock, request, request.body, reply),
  );
}
