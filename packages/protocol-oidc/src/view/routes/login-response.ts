import {
  clearedSignInHandleCookie,
  sessionCookies,
  type AuthenticatorResult,
} from '@odudu/authn-flows';
import { type PasswordRules } from '@odudu/kernel';
import { type FastifyReply } from 'fastify';
import { type LoginSubmissionOutcome } from '#/usecase/login-submission';
import { loginWays } from '#/service/login-ways';
import { renderEmailUnverifiedPage, renderLoginForm } from '#/view/authorize-html';
import { renderConsentPage } from '#/view/consent-html';
import { refusalMessage } from '#/view/login-messages';
import { sendHtml } from '#/view/html-response';
import { continuation, type TenantLocales } from '#/view/routes/continuation';
import { sendSignInExpired } from '#/view/routes/expired-sign-in';
import {
  sendRequiredActionPage,
  type RequiredActionResponseDeps,
} from '#/view/routes/required-action-response';

export interface LoginResponseDeps extends RequiredActionResponseDeps {
  tls: boolean;
  // Whether this deployment can offer a passkey login at all — see
  // renderLoginForm.
  passkeyLogin?: boolean;
  findTenant(name: string): Promise<
    | ({
        id: string;
        rememberMeAllowed: boolean;
        loginWithEmail: boolean;
        registrationAllowed: boolean;
        resetPasswordAllowed: boolean;
        passwordRules: PasswordRules;
      } & TenantLocales)
    | null
  >;
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
  authSessionId: string | undefined,
): Promise<FastifyReply> {
  if (outcome.kind === 'unauthenticated') {
    return sendSignInExpired(reply, deps, tenantName, authSessionId);
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
    // Before the first factor is verified: the subject's own locale must not
    // choose the language, or it would say whether the account exists.
    const { locale, continuing, clientName, signInPath } = await continuation(
      deps,
      tenantName,
      outcome.authSessionId,
      reply,
    );
    const page = renderLoginForm(
      tenantName,
      outcome.authSessionId,
      form,
      deps.passkeyLogin ?? false,
      tenant?.rememberMeAllowed ?? false,
      outcome.refusal === undefined
        ? undefined
        : {
            messageId: refusalMessage(form, outcome.refusal),
            ...(outcome.username === undefined ? {} : { username: outcome.username }),
          },
      tenant?.loginWithEmail ?? false,
      await clientName(),
      tenant === null ? {} : loginWays(tenantName, tenant, signInPath),
      locale,
    );
    return sendHtml(reply, 200, continuing(page));
  }

  // No location header and no code: the assertion this state exists to
  // make true is that nothing was issued, not that the page says something.
  if (outcome.kind === 'unverified') {
    const { locale, signInPath } = await continuation(
      deps,
      tenantName,
      outcome.authSessionId,
      reply,
    );
    return sendHtml(reply, 200, renderEmailUnverifiedPage(outcome.hasEmail, signInPath, locale));
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
    const { locale, continuing } = await continuation(
      deps,
      tenantName,
      outcome.authSessionId,
      reply,
      'authenticated',
    );
    const page = renderConsentPage(
      {
        tenant: tenantName,
        authSessionId: outcome.authSessionId,
        clientName: outcome.clientName,
        clientPages: outcome.clientPages,
        scopeLabels: outcome.scopeLabels,
        i18n: outcome.i18n,
        defaultScopes: outcome.defaultScopes,
        optionalScopes: outcome.optionalScopes,
        alreadyGranted: outcome.alreadyGranted,
      },
      locale,
    );
    return sendHtml(reply, 200, continuing(page));
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
  // The sign-in is finished: its handle has nothing left to name.
  reply302.header('set-cookie', clearedSignInHandleCookie(tenantName, deps.tls));
  return reply302.header('location', outcome.location).send();
}
