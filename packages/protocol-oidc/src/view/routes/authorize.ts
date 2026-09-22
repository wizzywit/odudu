import { type FastifyInstance, type FastifyReply } from 'fastify';
import { FORM_MEDIA_TYPE } from '#/service/media-type';
import {
  handleAuthorizationRequest,
  handleSelectAccountSubmission,
  type AuthorizationRequestOutcome,
  type AuthorizeUsecaseDeps,
} from '#/usecase/authorization-request';
import { renderAuthorizeErrorPage, renderLoginForm } from '#/view/authorize-html';
import { renderConsentPage } from '#/view/consent-html';
import { sendHtml } from '#/view/html-response';
import { tenantIssuerFor } from '#/view/issuer';
import { namesUnsupportedRepresentation } from '#/view/media-type';
import {
  sendRequiredActionPage,
  type RequiredActionResponseDeps,
} from '#/view/routes/required-action-response';
import { renderSelectAccountPage } from '#/view/select-account-html';

const PATH = '/tenants/:tenant/protocol/openid-connect/auth';

// Omits RequiredActionResponseDeps's own `findTenant`: AuthorizeUsecaseDeps
// already declares one — see consent.ts's identical comment for why
// TypeScript needs the omission even though the two signatures are
// structurally compatible.
export interface AuthorizeRouteDeps
  extends AuthorizeUsecaseDeps, Omit<RequiredActionResponseDeps, 'findTenant'> {
  tls: boolean;
  // Whether this deployment can offer a passkey login at all — see
  // renderLoginForm in #/view/authorize-html.
  passkeyLogin?: boolean;
}

// Shared by the authorization request itself and the account chooser's own
// POST below: both eventually reach an AuthorizationRequestOutcome — one
// directly, one via the reuse tail a chosen session completes the same
// way — and from there the response is identical.
async function renderAuthorizationOutcome(
  deps: AuthorizeRouteDeps,
  tenant: string,
  issuer: string,
  outcome: AuthorizationRequestOutcome,
  reply: FastifyReply,
): Promise<FastifyReply> {
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
      tenant,
      outcome.authSessionId,
      outcome.subjectId,
      outcome.action,
    );
  }

  // Neither a login form nor a single reused session answers this request:
  // the browser's cookies name more than one live session, or the client
  // asked with prompt=select_account. The chooser's own POST resumes the
  // authentication session parked here.
  if (outcome.kind === 'select') {
    return sendHtml(
      reply,
      200,
      renderSelectAccountPage({
        tenant,
        authSessionId: outcome.authSessionId,
        accounts: outcome.accounts,
      }),
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
        tenant,
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
    renderLoginForm(
      tenant,
      outcome.authSessionId,
      outcome.form,
      deps.passkeyLogin ?? false,
      outcome.rememberMeAllowed,
    ),
  );
}

// OIDC Core §3.1.2 requires both methods; they differ only in where the
// parameters come from, and share everything after, so they cannot drift
// out of agreement — down to a POST naming no representation answering
// exactly as a GET with no query parameters does. Parameters arrive as
// `unknown` because that is the truth: they are whatever a body parser
// produced, and normalizeAuthorizeQuery turns them back into strings.
async function respondToAuthorizationRequest(
  deps: AuthorizeRouteDeps,
  tenant: string,
  params: unknown,
  issuer: string,
  // The browser's raw `Cookie` header, passed through untouched: the
  // usecase resolves both session cookies out of it, so the route reaches
  // for no header itself.
  header: string | undefined,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const outcome = await handleAuthorizationRequest(deps, tenant, params, issuer, header);
  return renderAuthorizationOutcome(deps, tenant, issuer, outcome, reply);
}

function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// The chooser's POST: `login-actions/select-account`, mirroring the same
// naming consent and required-action already use for Odudu's own UI
// actions, never under /protocol/openid-connect/.
async function respondToSelectAccountSubmission(
  deps: AuthorizeRouteDeps,
  tenant: string,
  body: Record<string, string | string[] | undefined> | undefined,
  issuer: string,
  header: string | undefined,
  reply: FastifyReply,
): Promise<FastifyReply> {
  // Fastify leaves `request.body` undefined for a POST with no Content-Type
  // and no payload — normalised to an empty object so the ordinary
  // invalid_request handling below runs instead of throwing on a missing
  // read.
  const fields = body ?? {};
  const outcome = await handleSelectAccountSubmission(
    deps,
    tenant,
    firstString(fields.auth_session_id),
    {
      sessionId: firstString(fields.session_id),
      useOther: firstString(fields.use_other) !== undefined,
    },
    header,
  );

  if (outcome.kind === 'unauthenticated') {
    return sendHtml(
      reply,
      400,
      renderAuthorizeErrorPage(
        'invalid_request',
        'This sign-in attempt is no longer valid. Go back and start again.',
      ),
    );
  }

  // The security case: the posted session_id names no member of the set
  // this browser's own cookies resolve to. Refused, never honoured merely
  // because it names some live session in the tenant — see
  // handleSelectAccountSubmission's own comment on why.
  if (outcome.kind === 'invalid_selection') {
    return sendHtml(
      reply,
      400,
      renderAuthorizeErrorPage(
        'invalid_request',
        'That account is not one this browser is currently signed in to.',
      ),
    );
  }

  return renderAuthorizationOutcome(deps, tenant, issuer, outcome, reply);
}

export function registerAuthorizeRoute(app: FastifyInstance, deps: AuthorizeRouteDeps): void {
  app.get<{ Params: { tenant: string } }>(PATH, (request, reply) =>
    respondToAuthorizationRequest(
      deps,
      request.params.tenant,
      request.query,
      tenantIssuerFor(request, request.params.tenant),
      request.headers.cookie,
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
  app.post<{ Params: { tenant: string } }>(
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
        request.params.tenant,
        request.body,
        tenantIssuerFor(request, request.params.tenant),
        request.headers.cookie,
        reply,
      ),
  );

  app.post<{
    Params: { tenant: string };
    Body: Record<string, string | string[] | undefined> | undefined;
  }>('/tenants/:tenant/login-actions/select-account', (request, reply) =>
    respondToSelectAccountSubmission(
      deps,
      request.params.tenant,
      request.body,
      tenantIssuerFor(request, request.params.tenant),
      request.headers.cookie,
      reply,
    ),
  );
}
