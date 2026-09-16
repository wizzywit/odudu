import {
  renderPasskeyEnrolmentPage,
  renderRequiredActionPage,
  renderTotpEnrolmentPage,
  sessionCookieName,
  type AuthenticatorResult,
  type PasskeyAuthenticationOffer,
  type PasskeyEnrolmentOffer,
  type TotpEnrolmentOffer,
} from '@odudu/authn-flows';
import { isUuid } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';
import { handleLoginSubmission, type LoginSubmissionDeps } from '#/usecase/login-submission';
import {
  renderAuthorizeErrorPage,
  renderEmailUnverifiedPage,
  renderLoginForm,
} from '#/view/authorize-html';
import { sendHtml } from '#/view/html-response';
import { issuerBaseFor } from '#/view/issuer';

export interface LoginRouteDeps extends LoginSubmissionDeps {
  tls: boolean;
  // Whether this deployment can offer a passkey login at all — see
  // renderLoginForm. Absent, the page offers only the password, and
  // beginPasskeyAuthentication below is absent with it.
  passkeyLogin?: boolean;
  // What to render on a rejected attempt — asked directly rather than
  // threaded through LoginSubmissionOutcome, so handleLoginSubmission stays
  // as unaware of the flow's requirements as its own tests assume.
  pendingChallenge(realmId: string, authSessionId: string): Promise<AuthenticatorResult>;
  // The secret a configure-totp page shows. Asked for only when that action
  // is the one owed, so a login with nothing pending pays nothing for it.
  beginTotpEnrolment(
    realmName: string,
    realmId: string,
    subjectId: string,
  ): Promise<TotpEnrolmentOffer>;
  // The creation options a configure-passkey page hands the browser, and
  // the challenge it parks on this attempt. Absent when no relying party
  // can be derived, in which case the page that names the action without a
  // form to satisfy it is the honest answer.
  beginPasskeyEnrolment?(
    realmName: string,
    realmId: string,
    subjectId: string,
    authSessionId: string,
  ): Promise<PasskeyEnrolmentOffer>;
  // The request options the passkey button asks for, and the challenge it
  // parks on this attempt. Absent for the same reason the enrolment half is.
  beginPasskeyAuthentication?(
    realmId: string,
    authSessionId: string,
  ): Promise<PasskeyAuthenticationOffer>;
}

// pendingChallenge runs in its own transaction, separate from the advance()
// call that produced the reject — a realm whose executions change in that
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
  app.post<{ Params: { realm: string }; Body: Record<string, string | string[] | undefined> }>(
    '/realms/:realm/login-actions/passkey-challenge',
    async (request, reply) => {
      const authSessionId = firstString(request.body.auth_session_id);
      const realm = await deps.findRealm(request.params.realm);
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
        realm === null
      ) {
        return reply.code(400).send({ error: 'invalid_request' });
      }
      const offer = await beginPasskeyAuthentication(realm.id, authSessionId);
      return reply.code(200).send(offer.options);
    },
  );

  app.post<{
    Params: { realm: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/realms/:realm/login-actions/authenticate', async (request, reply) => {
    const body = request.body;
    const authSessionId = firstString(body.auth_session_id);
    const username = firstString(body.username);
    const password = firstString(body.password);
    const code = firstString(body.code);
    const assertion = firstString(body.assertion);

    const outcome = await handleLoginSubmission(
      deps,
      request.params.realm,
      issuerBaseFor(request),
      authSessionId,
      {
        ...(username !== undefined ? { username } : {}),
        ...(password !== undefined ? { password } : {}),
        ...(code !== undefined ? { code } : {}),
        // An empty field is not an attempt: a browser with JavaScript off
        // submits the passkey form with nothing in it, and forwarding that
        // would take the step away from the password.
        ...(assertion === undefined || assertion.length === 0
          ? {}
          : { assertion: parseAssertion(assertion) }),
      },
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
      // The realm was already resolved once, inside handleLoginSubmission,
      // to produce this very outcome — resolved again here rather than
      // threading its id back out through LoginSubmissionOutcome, which
      // would leak flow-engine concerns into a type login-submission's own
      // tests assert the shape of.
      const realm = await deps.findRealm(request.params.realm);
      const pending =
        realm === null ? null : await deps.pendingChallenge(realm.id, outcome.authSessionId);
      const form = pending?.kind === 'challenge' ? pending.form : FALLBACK_FORM;
      return sendHtml(
        reply,
        200,
        renderLoginForm(
          request.params.realm,
          outcome.authSessionId,
          form,
          deps.passkeyLogin ?? false,
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
      const realmName = request.params.realm;
      const beginPasskey = deps.beginPasskeyEnrolment?.bind(deps);
      if (outcome.action === 'configure-passkey' && beginPasskey !== undefined) {
        const realm = await deps.findRealm(realmName);
        if (realm !== null) {
          const offer = await beginPasskey(
            realmName,
            realm.id,
            outcome.subjectId,
            outcome.authSessionId,
          );
          return sendHtml(
            reply,
            200,
            renderPasskeyEnrolmentPage(realmName, outcome.authSessionId, offer),
          );
        }
      }
      if (outcome.action !== 'configure-totp') {
        return sendHtml(
          reply,
          200,
          renderRequiredActionPage(realmName, outcome.authSessionId, outcome.action),
        );
      }
      // The realm was already resolved inside handleLoginSubmission, for the
      // same reason the 'reject' branch above resolves it again.
      const realm = await deps.findRealm(realmName);
      if (realm === null) {
        return sendHtml(
          reply,
          200,
          renderRequiredActionPage(realmName, outcome.authSessionId, outcome.action),
        );
      }
      const offer = await deps.beginTotpEnrolment(realmName, realm.id, outcome.subjectId);
      return sendHtml(reply, 200, renderTotpEnrolmentPage(realmName, outcome.authSessionId, offer));
    }

    const cookieName = sessionCookieName(request.params.realm, deps.tls);
    const cookie = [
      `${cookieName}=${outcome.sessionId}`,
      'HttpOnly',
      'SameSite=Lax',
      'Path=/',
      ...(deps.tls ? ['Secure'] : []),
    ].join('; ');

    return reply.code(302).header('set-cookie', cookie).header('location', outcome.location).send();
  });
}
