import {
  sessionCookies,
  type AuthenticatorResult,
  type PasskeyAuthenticationOffer,
  type PasskeyEnrolmentOffer,
  type RecoveryCodesOffer,
  type TotpEnrolmentOffer,
} from '@odudu/authn-flows';
import { requestContextFrom } from '@odudu/domain-audit';
import { isUuid, PASSWORD_TOO_LONG, readPasswordField } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';
import { handleLoginSubmission, type LoginSubmissionDeps } from '#/usecase/login-submission';
import {
  renderAuthorizeErrorPage,
  renderEmailUnverifiedPage,
  renderLoginForm,
} from '#/view/authorize-html';
import { renderConsentPage } from '#/view/consent-html';
import { sendHtml } from '#/view/html-response';
import { issuerBaseFor } from '#/view/issuer';
import { sendRequiredActionPage } from '#/view/routes/required-action-response';

export interface LoginRouteDeps extends LoginSubmissionDeps {
  tls: boolean;
  // Whether this deployment can offer a passkey login at all — see
  // renderLoginForm. Absent, the page offers only the password, and
  // beginPasskeyAuthentication below is absent with it.
  passkeyLogin?: boolean;
  // What to render on a rejected attempt — asked directly rather than
  // threaded through LoginSubmissionOutcome, so handleLoginSubmission stays
  // as unaware of the flow's requirements as its own tests assume.
  pendingChallenge(tenantId: string, authSessionId: string): Promise<AuthenticatorResult>;
  // The secret a configure-totp page shows. Asked for only when that action
  // is the one owed, so a login with nothing pending pays nothing for it.
  beginTotpEnrolment(
    tenantName: string,
    tenantId: string,
    subjectId: string,
  ): Promise<TotpEnrolmentOffer>;
  // The creation options a configure-passkey page hands the browser, and
  // the challenge it parks on this attempt. Absent when no relying party
  // can be derived, in which case the page that names the action without a
  // form to satisfy it is the honest answer.
  beginPasskeyEnrolment?(
    tenantName: string,
    tenantId: string,
    subjectId: string,
    authSessionId: string,
  ): Promise<PasskeyEnrolmentOffer>;
  // The ten codes a generate-recovery-codes page shows, written as hashes
  // before it renders. Asked for only when that action is the one owed.
  beginRecoveryCodes(tenantId: string, subjectId: string): Promise<RecoveryCodesOffer>;
  // The request options the passkey button asks for, and the challenge it
  // parks on this attempt. Absent for the same reason the enrolment half is.
  beginPasskeyAuthentication?(
    tenantId: string,
    authSessionId: string,
  ): Promise<PasskeyAuthenticationOffer>;
}

// pendingChallenge runs in its own transaction, separate from the advance()
// call that produced the reject — a tenant whose executions change in that
// window (or a session that expires in it) can make pendingChallenge answer
// something other than a challenge. 'password' is what to fall back to,
// since it is the step every flow this server provisions starts with.
const FALLBACK_FORM = 'password';

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

    // No set-cookie: nothing was established to carry in one.
    if (outcome.kind === 'error_redirect') {
      return reply.code(302).header('location', outcome.location).send();
    }

    if (outcome.kind === 'reject') {
      // The tenant was already resolved once, inside handleLoginSubmission,
      // to produce this very outcome — resolved again here rather than
      // threading its id back out through LoginSubmissionOutcome, which
      // would leak flow-engine concerns into a type login-submission's own
      // tests assert the shape of.
      const tenant = await deps.findTenant(request.params.tenant);
      const pending =
        tenant === null ? null : await deps.pendingChallenge(tenant.id, outcome.authSessionId);
      const form = pending?.kind === 'challenge' ? pending.form : FALLBACK_FORM;
      return sendHtml(
        reply,
        200,
        renderLoginForm(
          request.params.tenant,
          outcome.authSessionId,
          form,
          deps.passkeyLogin ?? false,
          tenant?.rememberMeAllowed ?? false,
          outcome.reason,
        ),
      );
    }

    // No location header and no code: the assertion this state exists to
    // make true is that nothing was issued, not that the page says something.
    if (outcome.kind === 'unverified') {
      return sendHtml(reply, 200, renderEmailUnverifiedPage(outcome.hasEmail));
    }

    // Same reasoning as 'unverified': no location header and no code, since
    // nothing was established or issued.
    if (outcome.kind === 'required_action') {
      return sendRequiredActionPage(
        reply,
        deps,
        request.params.tenant,
        outcome.authSessionId,
        outcome.subjectId,
        outcome.action,
      );
    }

    // Same reasoning as 'unverified' and 'required_action': no location
    // header and no code, since nothing was established or issued.
    if (outcome.kind === 'consent') {
      return sendHtml(
        reply,
        200,
        renderConsentPage({
          tenant: request.params.tenant,
          authSessionId: outcome.authSessionId,
          clientName: outcome.clientName,
          defaultScopes: outcome.defaultScopes,
          optionalScopes: outcome.optionalScopes,
          alreadyGranted: outcome.alreadyGranted,
        }),
      );
    }

    const written = sessionCookies({
      tenant: request.params.tenant,
      tls: deps.tls,
      ephemeral: outcome.ephemeralSessionIds,
      persistent: outcome.persistentSessionIds,
      persistentMaxAgeSeconds: outcome.persistentMaxAgeSeconds,
    });

    const reply302 = reply.code(302);
    for (const cookie of written) reply302.header('set-cookie', cookie);
    return reply302.header('location', outcome.location).send();
  });
}
