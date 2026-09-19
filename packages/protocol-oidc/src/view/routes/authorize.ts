import { sessionCookieName } from '@odudu/authn-flows';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { FORM_MEDIA_TYPE } from '#/service/media-type';
import {
  handleAuthorizationRequest,
  type AuthorizeUsecaseDeps,
} from '#/usecase/authorization-request';
import { renderAuthorizeErrorPage, renderLoginForm } from '#/view/authorize-html';
import { renderConsentPage } from '#/view/consent-html';
import { sendHtml } from '#/view/html-response';
import { realmIssuerFor } from '#/view/issuer';
import { namesUnsupportedRepresentation } from '#/view/media-type';
import {
  sendRequiredActionPage,
  type RequiredActionResponseDeps,
} from '#/view/routes/required-action-response';

const PATH = '/realms/:realm/protocol/openid-connect/auth';

// Omits RequiredActionResponseDeps's own `findRealm`: AuthorizeUsecaseDeps
// already declares one — see consent.ts's identical comment for why
// TypeScript needs the omission even though the two signatures are
// structurally compatible.
export interface AuthorizeRouteDeps
  extends AuthorizeUsecaseDeps, Omit<RequiredActionResponseDeps, 'findRealm'> {
  tls: boolean;
  // Whether this deployment can offer a passkey login at all — see
  // renderLoginForm in #/view/authorize-html.
  passkeyLogin?: boolean;
}

// The cookie is read here and nowhere else on this path: the usecase
// receives a bare string and never the request, so it cannot reach for any
// other header no matter what a future change to it might try. A `Cookie`
// header this server cannot parse a named value out of is the same as no
// cookie — a malformed header names no live session either way.
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

// OIDC Core §3.1.2 requires both methods; they differ only in where the
// parameters come from, and share everything after, so they cannot drift
// out of agreement — down to a POST naming no representation answering
// exactly as a GET with no query parameters does. Parameters arrive as
// `unknown` because that is the truth: they are whatever a body parser
// produced, and normalizeAuthorizeQuery turns them back into strings.
async function respondToAuthorizationRequest(
  deps: AuthorizeRouteDeps,
  realm: string,
  params: unknown,
  issuer: string,
  cookieValue: string | undefined,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const outcome = await handleAuthorizationRequest(deps, realm, params, issuer, cookieValue);

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

  // A reused session: the same success shape the login POST redirects to,
  // with no set-cookie header — the session that got this request here
  // already has one.
  if (outcome.kind === 'reused') {
    const target = new URL(outcome.redirectUri);
    target.searchParams.set('code', outcome.code);
    if (outcome.state !== null) target.searchParams.set('state', outcome.state);
    target.searchParams.set('iss', issuer);
    return reply.code(302).header('location', target.toString()).send();
  }

  // A reused session that still owes a required action: the same page the
  // form path renders, on a freshly started authentication session the
  // reuse path bound and authenticated for the reused subject.
  if (outcome.kind === 'required_action') {
    return sendRequiredActionPage(
      reply,
      deps,
      realm,
      outcome.authSessionId,
      outcome.subjectId,
      outcome.action,
    );
  }

  // A reused session that still needs consent: the same page the form path
  // renders once its own gate asks, on a freshly started authentication
  // session the reuse path bound and authenticated for the reused subject.
  if (outcome.kind === 'consent') {
    return sendHtml(
      reply,
      200,
      renderConsentPage({
        realm,
        authSessionId: outcome.authSessionId,
        clientName: outcome.clientName,
        defaultScopes: outcome.defaultScopes,
        optionalScopes: outcome.optionalScopes,
        alreadyGranted: outcome.alreadyGranted,
      }),
    );
  }

  return sendHtml(
    reply,
    200,
    renderLoginForm(realm, outcome.authSessionId, outcome.form, deps.passkeyLogin ?? false),
  );
}

export function registerAuthorizeRoute(app: FastifyInstance, deps: AuthorizeRouteDeps): void {
  app.get<{ Params: { realm: string } }>(PATH, (request, reply) =>
    respondToAuthorizationRequest(
      deps,
      request.params.realm,
      request.query,
      realmIssuerFor(request, request.params.realm),
      readCookie(request, sessionCookieName(request.params.realm, deps.tls)),
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
        readCookie(request, sessionCookieName(request.params.realm, deps.tls)),
        reply,
      ),
  );
}
