import { type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { requestContextFrom } from '@odudu/domain-audit';
import { PASSWORD_TOO_LONG, readPasswordField } from '@odudu/kernel';
import { type FastifyInstance } from 'fastify';
import { peekActionToken } from '#/usecase/action-token';
import {
  completePasswordReset,
  type PasswordPolicy,
  type PolicyViolation,
} from '#/usecase/reset-password';
import { completeEmailVerification } from '#/usecase/verify-email';
import {
  renderResetLinkFailedPage,
  renderResetPasswordForm,
  renderResetPasswordRequiredPage,
  renderResetPasswordSucceededPage,
  renderResetPasswordWeakPage,
} from '#/view/reset-html';
import {
  renderVerificationFailedPage,
  renderVerificationSucceededPage,
  sendVerificationHtml,
} from '#/view/verification-html';

export interface ActionTokenTenantLookup {
  readonly id: string;
  readonly enabled: boolean;
  // The kill switch: an operator who turns this off during an incident
  // means every outstanding reset-password link to stop working too, not
  // only the request form. A verify-email link is unaffected — redeeming
  // one is gated on tenant.enabled alone, the same as before this flag
  // existed.
  readonly resetPasswordAllowed: boolean;
  readonly passwordPolicy: PasswordPolicy;
}

export interface ActionTokenRouteDeps {
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

// Not under /protocol/openid-connect/: this is Odudu's own account UI, the
// same namespace choice login.ts documents for /login-actions/authenticate.
export function registerActionTokenRoute(app: FastifyInstance, deps: ActionTokenRouteDeps): void {
  app.get<{
    Params: { tenant: string };
    Querystring: Record<string, string | string[] | undefined>;
  }>('/tenants/:tenant/login-actions/action-token', async (request, reply) => {
    const key = firstString(request.query.key);
    const tenant = key === undefined ? null : await deps.findTenant(request.params.tenant);

    // A disabled tenant refuses here the same way it refuses at /token,
    // /userinfo, discovery and login: consuming a token is a write against
    // that tenant's users table, and disabling a tenant is meant to stop all
    // of those, not just the ones a client can see.
    if (key === undefined || !tenant?.enabled) {
      return sendVerificationHtml(reply, 400, renderVerificationFailedPage());
    }

    // A read, not a redemption: a reset-password link needs a page shown
    // before anything is consumed, so its type has to be known ahead of
    // that decision. A verify-email link consumes on this same GET, the
    // way it always has — peeking first only tells the two branches apart,
    // it never changes the verify-email one's behaviour.
    const peeked = await peekActionToken({ database: deps.database, tenantId: tenant.id }, key);
    if (peeked.kind === 'invalid') {
      return sendVerificationHtml(reply, 400, renderVerificationFailedPage());
    }

    if (peeked.type === 'reset_password') {
      if (!tenant.resetPasswordAllowed) {
        return sendVerificationHtml(reply, 400, renderResetLinkFailedPage());
      }
      return sendVerificationHtml(reply, 200, renderResetPasswordForm(request.params.tenant, key));
    }

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

    if (result.kind === 'invalid') {
      return sendVerificationHtml(reply, 400, renderVerificationFailedPage());
    }
    return sendVerificationHtml(reply, 200, renderVerificationSucceededPage());
  });

  app.post<{
    Params: { tenant: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/tenants/:tenant/login-actions/action-token', async (request, reply) => {
    const body = request.body;
    const key = firstNonEmptyString(body.key);
    const candidate = readPasswordField(body.password);
    const tenant = key === undefined ? null : await deps.findTenant(request.params.tenant);

    if (key === undefined || !tenant?.enabled || !tenant.resetPasswordAllowed) {
      return sendVerificationHtml(reply, 400, renderResetLinkFailedPage());
    }

    // Listed as a rule of the policy, because to the person typing it that
    // is what it is — but decided here rather than in evaluatePassword, so
    // the length is bounded before anything hashes it.
    if (candidate.kind === 'too_long') {
      return sendVerificationHtml(
        reply,
        400,
        renderResetPasswordWeakPage([PASSWORD_TOO_LONG.message]),
      );
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
      return sendVerificationHtml(reply, 400, renderResetPasswordRequiredPage());
    }

    const result = await completePasswordReset(
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
      },
      key,
      password,
    );

    if (result.kind === 'invalid_password') {
      return sendVerificationHtml(
        reply,
        400,
        renderResetPasswordWeakPage(result.violations.map((v) => v.message)),
      );
    }
    if (result.kind === 'invalid') {
      return sendVerificationHtml(reply, 400, renderResetLinkFailedPage());
    }
    return sendVerificationHtml(reply, 200, renderResetPasswordSucceededPage());
  });
}
