import { sessionCookies, type AuthenticatorResult } from '@odudu/authn-flows';
import { type FastifyReply } from 'fastify';
import { type LoginSubmissionOutcome } from '#/usecase/login-submission';
import {
  renderAuthorizeErrorPage,
  renderEmailUnverifiedPage,
  renderLoginForm,
} from '#/view/authorize-html';
import { renderConsentPage } from '#/view/consent-html';
import { sendHtml } from '#/view/html-response';
import { continuing } from '#/view/routes/continuation';
import {
  sendRequiredActionPage,
  type RequiredActionResponseDeps,
} from '#/view/routes/required-action-response';

export interface LoginResponseDeps extends RequiredActionResponseDeps {
  tls: boolean;
  // Whether this deployment can offer a passkey login at all — see
  // renderLoginForm.
  passkeyLogin?: boolean;
  findTenant(
    name: string,
  ): Promise<{ id: string; rememberMeAllowed: boolean; loginWithEmail: boolean } | null>;
  // What to render on a rejected attempt — asked directly rather than
  // threaded through LoginSubmissionOutcome, so handleLoginSubmission stays
  // as unaware of the flow's requirements as its own tests assume.
  pendingChallenge(tenantId: string, authSessionId: string): Promise<AuthenticatorResult>;
}

// pendingChallenge runs in its own transaction, separate from the advance()
// call that produced the reject — a tenant whose executions change in that
// window (or a session that expires in it) can make pendingChallenge answer
// something other than a challenge. 'password' is what to fall back to,
// since it is the step every flow this server provisions starts with.
const FALLBACK_FORM = 'password';

// The one place a LoginSubmissionOutcome becomes a response: the login form's
// own POST, and a finished required action resuming the login it was parked
// on, answer the same outcome with the same page.
export async function sendLoginOutcome(
  reply: FastifyReply,
  deps: LoginResponseDeps,
  tenantName: string,
  outcome: LoginSubmissionOutcome,
): Promise<FastifyReply> {
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
    const tenant = await deps.findTenant(tenantName);
    const pending =
      tenant === null ? null : await deps.pendingChallenge(tenant.id, outcome.authSessionId);
    const form = pending?.kind === 'challenge' ? pending.form : FALLBACK_FORM;
    const page = renderLoginForm(
      tenantName,
      outcome.authSessionId,
      form,
      deps.passkeyLogin ?? false,
      tenant?.rememberMeAllowed ?? false,
      outcome.reason,
      tenant?.loginWithEmail ?? false,
    );
    return sendHtml(reply, 200, await continuing(deps, tenantName, outcome.authSessionId, page));
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
      tenantName,
      outcome.authSessionId,
      outcome.subjectId,
      outcome.action,
    );
  }

  // Same reasoning as 'unverified' and 'required_action': no location
  // header and no code, since nothing was established or issued.
  if (outcome.kind === 'consent') {
    const page = renderConsentPage({
      tenant: tenantName,
      authSessionId: outcome.authSessionId,
      clientName: outcome.clientName,
      clientPages: outcome.clientPages,
      scopeLabels: outcome.scopeLabels,
      defaultScopes: outcome.defaultScopes,
      optionalScopes: outcome.optionalScopes,
      alreadyGranted: outcome.alreadyGranted,
    });
    return sendHtml(reply, 200, await continuing(deps, tenantName, outcome.authSessionId, page));
  }

  const written = sessionCookies({
    tenant: tenantName,
    tls: deps.tls,
    ephemeral: outcome.ephemeralSessions,
    persistent: outcome.persistentSessions,
    persistentMaxAgeSeconds: outcome.persistentMaxAgeSeconds,
  });

  const reply302 = reply.code(302);
  for (const cookie of written) reply302.header('set-cookie', cookie);
  return reply302.header('location', outcome.location).send();
}
