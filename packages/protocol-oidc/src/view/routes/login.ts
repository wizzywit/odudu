import { type PasskeyAuthenticationOffer } from '@odudu/authn-flows';
import { requestContextFrom } from '@odudu/domain-audit';
import { isUuid, PASSWORD_TOO_LONG, readPasswordField } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';
import { handleLoginSubmission, type LoginSubmissionDeps } from '#/usecase/login-submission';
import { renderAuthorizeErrorPage } from '#/view/authorize-html';
import { sendHtml } from '#/view/html-response';
import { issuerBaseFor } from '#/view/issuer';
import { sendLoginOutcome, type LoginResponseDeps } from '#/view/routes/login-response';

// Omits LoginResponseDeps's own `findTenant`: LoginSubmissionDeps declares
// one returning the repository's TenantLookup, which satisfies it, and
// TypeScript refuses two same-named members that are not identical.
export interface LoginRouteDeps
  extends LoginSubmissionDeps, Omit<LoginResponseDeps, 'findTenant' | 'loadPendingRequest'> {
  // The request options the passkey button asks for, and the challenge it
  // parks on this attempt. Absent where no relying party can be derived.
  beginPasskeyAuthentication?(
    tenantId: string,
    authSessionId: string,
  ): Promise<PasskeyAuthenticationOffer>;
}

// @fastify/formbody parses a repeated field into an array; every field this
// handler reads is meant to carry exactly one value, so a repeat is treated
// as absent rather than silently picking one.
function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

// What the browser posts is a string; whether it is JSON at all is the
// authenticator's business, so an unparseable field arrives as the `null`
// that every other malformed assertion also produces.
function parseAssertion(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

// Deliberately not under /protocol/openid-connect/: that namespace is the
// OIDC wire protocol, and this is Odudu's own login UI, which no
// specification describes and no client library calls.
export function registerLoginRoute(app: FastifyInstance, deps: LoginRouteDeps): void {
  // Its own endpoint rather than options rendered into the login page: the
  // challenge is issued when the button is pressed, so a page left open
  // does not hand a stale one to an authenticator, and a rejected attempt
  // needs no fresh render to try a passkey again.
  const beginPasskeyAuthentication = deps.beginPasskeyAuthentication?.bind(deps);
  app.post<{ Params: { tenant: string }; Body: Record<string, string | string[] | undefined> }>(
    '/tenants/:tenant/login-actions/passkey-challenge',
    async (request, reply) => {
      const authSessionId = firstString(request.body.auth_session_id);
      const tenant = await deps.findTenant(request.params.tenant);
      // No existence check on the attempt, deliberately: the id is the
      // unguessable value that CSRF-protects this whole path, and parking a
      // challenge against an id no row has updates nothing. An assertion
      // answering it then finds no challenge, which is the same refusal a
      // replay gets.
      // Shape-checked here, for the reason handleLoginSubmission gives: this
      // writes a challenge against the id, so a value Postgres cannot parse
      // as a uuid would raise rather than update nothing.
      if (
        beginPasskeyAuthentication === undefined ||
        authSessionId === undefined ||
        !isUuid(authSessionId) ||
        tenant === null
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const offer = await beginPasskeyAuthentication(tenant.id, authSessionId);
      return reply.code(200).send(offer.options);
    },
  );

  app.post<{
    Params: { tenant: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/tenants/:tenant/login-actions/authenticate', async (request, reply) => {
    const body = request.body;
    const authSessionId = firstString(body.auth_session_id);
    const username = firstString(body.username);
    const candidate = readPasswordField(body.password);
    // Refused before handleLoginSubmission, which is where the Argon2id
    // verification is: this is the one password route that verifies rather
    // than evaluates, so nothing downstream would bound the length.
    if (candidate.kind === 'too_long') {
      return sendHtml(
        reply,
        400,
        renderAuthorizeErrorPage('invalid_request', PASSWORD_TOO_LONG.message),
      );
    }
    const password = candidate.kind === 'present' ? candidate.password : undefined;
    const code = firstString(body.code);
    const recoveryCode = firstString(body.recovery_code);
    const assertion = firstString(body.assertion);
    // Whether the checkbox was ticked, exactly as submitted — the tenant's
    // rememberMeAllowed is what decides whether this does anything at all;
    // see login-submission.ts's gate.
    const rememberMe = firstString(body.remember_me) === 'true';

    const outcome = await handleLoginSubmission(
      deps,
      request.params.tenant,
      issuerBaseFor(request),
      authSessionId,
      {
        ...(username !== undefined ? { username } : {}),
        ...(password !== undefined ? { password } : {}),
        ...(code !== undefined ? { code } : {}),
        // An empty field is not an attempt, for the same reason an empty
        // assertion is not: the second-factor form carries both inputs, and
        // a blank recovery code must leave the step to the one that was
        // actually filled in.
        ...(recoveryCode === undefined || recoveryCode.length === 0 ? {} : { recoveryCode }),
        // An empty field is not an attempt: a browser with JavaScript off
        // submits the passkey form with nothing in it, and forwarding that
        // would take the step away from the password.
        ...(assertion === undefined || assertion.length === 0
          ? {}
          : { assertion: parseAssertion(assertion) }),
      },
      requestContextFrom(request),
      request.headers.cookie,
      rememberMe,
    );

    return sendLoginOutcome(reply, deps, request.params.tenant, outcome);
  });
}
