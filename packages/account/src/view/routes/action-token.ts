import { type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { requestContextFrom } from '@odudu/domain-audit';
import { PASSWORD_TOO_LONG, readPasswordField, type PageLocale } from '@odudu/kernel';
import { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { resumablePath, type FindHeldSignIn } from '#/service/sign-in-resume';
import { peekActionToken, type LinkedRequiredAction } from '#/usecase/action-token';
import { type PasswordFailure } from '#/view/password-rules';
import {
  completePasswordReset,
  type AccountRecoveryDeps,
  type PasswordPolicy,
  type PolicyViolation,
} from '#/usecase/reset-password';
import {
  completeRequiredActions,
  type CompleteRequiredActionsDeps,
} from '#/usecase/execute-actions';
import { completeEmailVerification } from '#/usecase/verify-email';
import {
  completeRegistration,
  isRegistrationKey,
  registrationWaiting,
  type VerifiedAccountInput,
} from '#/usecase/complete-registration';
import { type TakenIdentifiers } from '#/usecase/register';
import {
  renderResetLinkFailedPage,
  renderResetPasswordForm,
  renderResetPasswordFactorsRemovedPage,
  renderResetPasswordSucceededPage,
} from '#/view/reset-html';
import {
  renderRequiredActionsForm,
  renderRequiredActionsFactorsRemovedPage,
  renderRequiredActionsSucceededPage,
} from '#/view/required-actions-html';
import {
  renderEmailConfirmPage,
  renderVerificationFailedPage,
  renderVerificationSucceededPage,
  sendVerificationHtml,
} from '#/view/verification-html';
import {
  renderRegistrationReadyPage,
  renderRegistrationUsernameGonePage,
} from '#/view/registration-html';
import { brandedLocale, type BrandedLocaleDeps } from '#/view/request-locale';

export interface ActionTokenTenantLookup {
  readonly id: string;
  readonly supportedLocales: readonly string[];
  readonly defaultLocale: string | null;
  readonly enabled: boolean;
  // The kill switch: an operator who turns this off during an incident
  // means every outstanding reset-password link to stop working too, not
  // only the request form. A verify-email link is unaffected — redeeming
  // one is gated on tenant.enabled alone, the same as before this flag
  // existed.
  readonly resetPasswordAllowed: boolean;
  // A pending registration is made only while the tenant still takes them.
  readonly registrationAllowed: boolean;
  readonly passwordPolicy: PasswordPolicy;
}

// What the issuer is read from: the request itself, which carries the
// configured public address when there is one.
export type IssuerSource = Pick<FastifyRequest, 'protocol' | 'host'> & {
  readonly configuredIssuerBase?: string | undefined;
};

export interface ActionTokenRouteDeps extends BrandedLocaleDeps {
  readonly database: DatabaseHandle;
  readonly findTenant: (name: string) => Promise<ActionTokenTenantLookup | null>;
  readonly getCurrentEmail: (tx: TenantScopedDatabase, subjectId: string) => Promise<string | null>;
  readonly markVerified: (tx: TenantScopedDatabase, subjectId: string) => Promise<void>;
  // Injected for the same reason getCurrentEmail and markVerified are:
  // @odudu/account never imports @odudu/domain-identity, where hashPassword
  // and the credentials table live.
  readonly setPassword: (
    tx: TenantScopedDatabase,
    subjectId: string,
    newPassword: string,
  ) => Promise<void>;
  readonly getUsername: (tx: TenantScopedDatabase, subjectId: string) => Promise<string>;
  readonly evaluatePassword: (
    candidate: string,
    policy: PasswordPolicy,
    subject: { username: string; email: string | null },
  ) => PolicyViolation[];
  // Both injected for the same reason setPassword is — see
  // completePasswordReset in #/usecase/reset-password.ts, which explains
  // what each one closes.
  readonly unchangedPasswordViolations: (
    tx: TenantScopedDatabase,
    subjectId: string,
    candidate: string,
  ) => Promise<PolicyViolation[]>;
  readonly clearPasswordUpdateAction: (
    tx: TenantScopedDatabase,
    subjectId: string,
  ) => Promise<void>;
  // Injected for the same reason: the subject's owed actions are
  // @odudu/authn-flows' table, which this package does not import.
  readonly addRequiredActions: CompleteRequiredActionsDeps['addRequiredActions'];
  // The sign-in this browser parked and can still finish, if any: the one
  // place a link's page learns whether to offer a way back to it.
  readonly findHeldSignIn: FindHeldSignIn;
  // What opening a registration link needs, injected like register's:
  // the identity tables belong to @odudu/domain-identity.
  readonly now: () => Date;
  readonly findTaken: (
    tx: TenantScopedDatabase,
    tenantId: string,
    who: { username: string; email: string },
  ) => Promise<TakenIdentifiers>;
  // Ends every session and revokes every grant of the subject, for a recovered
  // account. The request names the issuer the back-channel logout tokens carry.
  readonly endAccess: (
    tx: TenantScopedDatabase,
    tenant: { id: string; name: string },
    subjectId: string,
    request: IssuerSource,
  ) => Promise<void>;
  readonly proveAddress: AccountRecoveryDeps['proveAddress'];
  readonly lockAddress: (
    tx: TenantScopedDatabase,
    tenantId: string,
    email: string,
  ) => Promise<void>;
  readonly createVerifiedAccount: (
    tx: TenantScopedDatabase,
    tenantId: string,
    input: VerifiedAccountInput,
  ) => Promise<{ subjectId: string }>;
}

// @fastify/formbody parses a repeated query or body field into an array; a
// repeat is treated as absent rather than silently picking one, the same
// rule packages/protocol-oidc/src/view/routes/login.ts's firstString
// applies.
function firstString(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function firstNonEmptyString(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}

// Where a person whose reset link failed asks for another: this tenant's
// own request form, offered only while the tenant still allows resets.
function newResetLink(tenantName: string, tenant: ActionTokenTenantLookup): string | null {
  return tenant.resetPasswordAllowed
    ? `/tenants/${encodeURIComponent(tenantName)}/login-actions/reset-password`
    : null;
}

// Where this link's page may send the browser: the original sign-in, only
// while this browser still holds the one the link came out of. One point read,
// made only when the link names a sign-in at all.
async function resumeAt(
  deps: ActionTokenRouteDeps,
  request: FastifyRequest<{ Params: { tenant: string } }>,
  tenant: ActionTokenTenantLookup,
  reference: string | null | undefined,
): Promise<string | null> {
  if (reference === null || reference === undefined) return null;
  const held = await deps.findHeldSignIn(
    { id: tenant.id, name: request.params.tenant },
    request.headers.cookie,
  );
  return resumablePath(held, reference);
}

async function completeActionsLink(
  request: FastifyRequest<{
    Params: { tenant: string };
    Body: Record<string, string | string[] | undefined>;
  }>,
  reply: FastifyReply,
  deps: ActionTokenRouteDeps,
  tenant: ActionTokenTenantLookup,
  key: string,
  peeked: {
    actions: readonly LinkedRequiredAction[];
    setsPassword: boolean;
    authenticationSessionId: string | null;
  },
  locale: PageLocale,
): Promise<FastifyReply> {
  const { setsPassword } = peeked;
  const returnTo = (): Promise<string | null> =>
    resumeAt(deps, request, tenant, peeked.authenticationSessionId);
  // The form the link opened, back in place with why the password was refused.
  const again = (failure: PasswordFailure): FastifyReply =>
    sendVerificationHtml(
      reply,
      400,
      renderRequiredActionsForm(
        request.params.tenant,
        key,
        peeked.actions,
        setsPassword,
        failure,
        tenant.passwordPolicy,
        locale,
      ),
    );
  if (setsPassword && !tenant.resetPasswordAllowed) {
    return sendVerificationHtml(
      reply,
      400,
      renderResetLinkFailedPage(null, await returnTo(), locale),
    );
  }
  const candidate = readPasswordField(request.body.password);
  if (candidate.kind === 'too_long') {
    return again([PASSWORD_TOO_LONG]);
  }
  const password =
    candidate.kind === 'present' && candidate.password.length > 0 ? candidate.password : undefined;

  const result = await completeRequiredActions(
    {
      database: deps.database,
      tenantId: tenant.id,
      request: requestContextFrom(request),
      setPassword: deps.setPassword,
      passwordPolicy: tenant.passwordPolicy,
      evaluatePassword: deps.evaluatePassword,
      getUsername: deps.getUsername,
      unchangedPasswordViolations: deps.unchangedPasswordViolations,
      clearPasswordUpdateAction: deps.clearPasswordUpdateAction,
      addRequiredActions: deps.addRequiredActions,
      endAccess: (tx, subjectId) =>
        deps.endAccess(tx, { id: tenant.id, name: request.params.tenant }, subjectId, request),
      proveAddress: deps.proveAddress,
    },
    key,
    password,
  );
  switch (result.kind) {
    case 'invalid':
      return sendVerificationHtml(
        reply,
        400,
        renderResetLinkFailedPage(null, await returnTo(), locale),
      );
    case 'password_required':
      return again('required');
    case 'invalid_password':
      return again(result.violations);
    case 'done':
      return sendVerificationHtml(
        reply,
        200,
        (result.factorsRemoved
          ? renderRequiredActionsFactorsRemovedPage
          : renderRequiredActionsSucceededPage)(result.remaining, await returnTo(), locale),
      );
  }
}

// The button on a registration link's page: creates the account, in one
// transaction, and says how it went. A key nothing holds gets the page any
// refused link gets, whether it was read or posted.
async function finishRegistration(
  request: FastifyRequest<{ Params: { tenant: string } }>,
  reply: FastifyReply,
  deps: ActionTokenRouteDeps,
  tenant: ActionTokenTenantLookup,
  key: string,
  locale: PageLocale,
): Promise<FastifyReply> {
  const result = tenant.registrationAllowed
    ? await completeRegistration(
        {
          database: deps.database,
          tenantId: tenant.id,
          request: requestContextFrom(request),
          now: deps.now,
          lockAddress: deps.lockAddress,
          createVerifiedAccount: deps.createVerifiedAccount,
          findTaken: deps.findTaken,
        },
        key,
      )
    : ({ kind: 'invalid' } as const);
  if (result.kind === 'username_taken') {
    return sendVerificationHtml(
      reply,
      409,
      renderRegistrationUsernameGonePage(request.params.tenant, locale),
    );
  }
  if (result.kind === 'invalid') {
    return sendVerificationHtml(reply, 400, renderVerificationFailedPage(null, locale));
  }
  return sendVerificationHtml(
    reply,
    200,
    renderRegistrationReadyPage(
      await resumeAt(deps, request, tenant, result.authenticationSessionId),
      locale,
    ),
  );
}

// Not under /protocol/openid-connect/: this is Odudu's own account UI, the
// same namespace choice login.ts documents for /login-actions/authenticate.
export function registerActionTokenRoute(app: FastifyInstance, deps: ActionTokenRouteDeps): void {
  app.get<{
    Params: { tenant: string };
    Querystring: Record<string, string | string[] | undefined>;
  }>('/tenants/:tenant/login-actions/action-token', async (request, reply) => {
    const key = firstString(request.query.key);
    const tenant = key === undefined ? null : await deps.findTenant(request.params.tenant);
    // A mailed link names no client, so the page wears the tenant's theme.
    const locale = await brandedLocale(
      request,
      deps,
      tenant === null
        ? null
        : {
            id: tenant.id,
            name: request.params.tenant,
            supportedLocales: tenant.supportedLocales,
            defaultLocale: tenant.defaultLocale,
          },
    );

    // A disabled tenant refuses here the same way it refuses at /token,
    // /userinfo, discovery and login: consuming a token is a write against
    // that tenant's users table, and disabling a tenant is meant to stop all
    // of those, not just the ones a client can see.
    if (key === undefined || !tenant?.enabled) {
      return sendVerificationHtml(reply, 400, renderVerificationFailedPage(null, locale));
    }

    // A visit changes nothing: mail scanners and link previews open mailed
    // links before the person does. One button posts the key back.
    if (isRegistrationKey(key)) {
      const waiting = tenant.registrationAllowed
        ? await registrationWaiting(
            { database: deps.database, tenantId: tenant.id, now: deps.now },
            key,
          )
        : null;
      return waiting === null
        ? sendVerificationHtml(reply, 400, renderVerificationFailedPage(null, locale))
        : sendVerificationHtml(
            reply,
            200,
            renderEmailConfirmPage(request.params.tenant, key, waiting.username, locale),
          );
    }

    // A read, never a redemption: what each kind of link shows is decided from
    // its type, and nothing is consumed until the page's own form is posted.
    const peeked = await peekActionToken({ database: deps.database, tenantId: tenant.id }, key);
    const resume = (): Promise<string | null> =>
      resumeAt(deps, request, tenant, peeked.authenticationSessionId);
    if (peeked.kind === 'invalid') {
      // A reset or actions link the row of which is still held says so, and a
      // reset link offers a new one; any other refusal stays the generic page.
      if (peeked.type === 'reset_password' || peeked.type === 'execute_actions') {
        return sendVerificationHtml(
          reply,
          400,
          renderResetLinkFailedPage(
            peeked.type === 'reset_password' ? newResetLink(request.params.tenant, tenant) : null,
            await resume(),
            locale,
          ),
        );
      }
      return sendVerificationHtml(reply, 400, renderVerificationFailedPage(await resume(), locale));
    }

    if (peeked.type === 'reset_password') {
      if (!tenant.resetPasswordAllowed) {
        return sendVerificationHtml(
          reply,
          400,
          renderResetLinkFailedPage(null, await resume(), locale),
        );
      }
      return sendVerificationHtml(
        reply,
        200,
        renderResetPasswordForm(
          request.params.tenant,
          key,
          undefined,
          tenant.passwordPolicy,
          locale,
        ),
      );
    }

    // A link that sets a password is a reset link, and the reset kill switch
    // stops it the same way.
    if (peeked.type === 'execute_actions') {
      if (peeked.setsPassword && !tenant.resetPasswordAllowed) {
        return sendVerificationHtml(
          reply,
          400,
          renderResetLinkFailedPage(null, await resume(), locale),
        );
      }
      return sendVerificationHtml(
        reply,
        200,
        renderRequiredActionsForm(
          request.params.tenant,
          key,
          peeked.actions,
          peeked.setsPassword,
          undefined,
          tenant.passwordPolicy,
          locale,
        ),
      );
    }

    return sendVerificationHtml(
      reply,
      200,
      renderEmailConfirmPage(request.params.tenant, key, null, locale),
    );
  });

  app.post<{
    Params: { tenant: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/tenants/:tenant/login-actions/action-token', async (request, reply) => {
    const body = request.body;
    const key = firstNonEmptyString(body.key);
    const candidate = readPasswordField(body.password);
    const tenant = key === undefined ? null : await deps.findTenant(request.params.tenant);
    const locale = await brandedLocale(
      request,
      deps,
      tenant === null
        ? null
        : {
            id: tenant.id,
            name: request.params.tenant,
            supportedLocales: tenant.supportedLocales,
            defaultLocale: tenant.defaultLocale,
          },
    );

    if (key === undefined || !tenant?.enabled) {
      return sendVerificationHtml(reply, 400, renderResetLinkFailedPage(null, null, locale));
    }

    if (isRegistrationKey(key))
      return finishRegistration(request, reply, deps, tenant, key, locale);

    const peeked = await peekActionToken({ database: deps.database, tenantId: tenant.id }, key);
    const resume = (): Promise<string | null> =>
      resumeAt(deps, request, tenant, peeked.authenticationSessionId);
    if (peeked.kind === 'usable' && peeked.type === 'verify_email') {
      const result = await completeEmailVerification(
        {
          database: deps.database,
          tenantId: tenant.id,
          request: requestContextFrom(request),
          getCurrentEmail: deps.getCurrentEmail,
          markVerified: deps.markVerified,
        },
        key,
      );
      return result.kind === 'invalid'
        ? sendVerificationHtml(reply, 400, renderVerificationFailedPage(await resume(), locale))
        : sendVerificationHtml(reply, 200, renderVerificationSucceededPage(await resume(), locale));
    }
    if (peeked.kind === 'invalid' && peeked.type === 'verify_email') {
      return sendVerificationHtml(reply, 400, renderVerificationFailedPage(await resume(), locale));
    }
    if (peeked.kind === 'usable' && peeked.type === 'execute_actions') {
      return completeActionsLink(request, reply, deps, tenant, key, peeked, locale);
    }
    if (!tenant.resetPasswordAllowed) {
      return sendVerificationHtml(
        reply,
        400,
        renderResetLinkFailedPage(null, await resume(), locale),
      );
    }
    // A key nothing usable holds gets the link-failed page whatever else was
    // posted, rather than a form for a link that can no longer be redeemed.
    if (peeked.kind === 'invalid') {
      return sendVerificationHtml(
        reply,
        400,
        renderResetLinkFailedPage(
          newResetLink(request.params.tenant, tenant),
          await resume(),
          locale,
        ),
      );
    }
    // The form this submission came from, back in place with why it was refused.
    const again = (failure: PasswordFailure): FastifyReply =>
      sendVerificationHtml(
        reply,
        400,
        renderResetPasswordForm(request.params.tenant, key, failure, tenant.passwordPolicy, locale),
      );

    // Listed as a rule of the policy, because to the person typing it that
    // is what it is — but decided here rather than in evaluatePassword, so
    // the length is bounded before anything hashes it.
    if (candidate.kind === 'too_long') {
      return again([PASSWORD_TOO_LONG]);
    }
    const password =
      candidate.kind === 'present' && candidate.password.length > 0
        ? candidate.password
        : undefined;

    // Distinct from the link being unusable: the key is present and has
    // not been checked yet, so telling the redeemer their link "can't be
    // used" here would be false — it is a missing field, not a spent or
    // expired token.
    if (password === undefined) {
      return again('required');
    }

    const result = await completePasswordReset(
      {
        database: deps.database,
        tenantId: tenant.id,
        request: requestContextFrom(request),
        setPassword: deps.setPassword,
        endAccess: (tx, subjectId) =>
          deps.endAccess(tx, { id: tenant.id, name: request.params.tenant }, subjectId, request),
        proveAddress: deps.proveAddress,
        passwordPolicy: tenant.passwordPolicy,
        evaluatePassword: deps.evaluatePassword,
        getUsername: deps.getUsername,
        unchangedPasswordViolations: deps.unchangedPasswordViolations,
        clearPasswordUpdateAction: deps.clearPasswordUpdateAction,
      },
      key,
      password,
    );

    if (result.kind === 'invalid_password') {
      return again(result.violations);
    }
    if (result.kind === 'invalid') {
      return sendVerificationHtml(
        reply,
        400,
        renderResetLinkFailedPage(
          newResetLink(request.params.tenant, tenant),
          await resume(),
          locale,
        ),
      );
    }
    return sendVerificationHtml(
      reply,
      200,
      (result.factorsRemoved
        ? renderResetPasswordFactorsRemovedPage
        : renderResetPasswordSucceededPage)(await resume(), locale),
    );
  });
}
