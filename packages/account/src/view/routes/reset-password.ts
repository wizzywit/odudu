import { type DatabaseHandle, type TenantScopedDatabase } from '@odudu/db';
import { type FastifyInstance } from 'fastify';
import { requestPasswordReset } from '#/usecase/reset-password';
import {
  renderResetRequestedPage,
  renderResetRequestFailedPage,
  renderResetRequestForm,
  sendResetHtml,
} from '#/view/reset-html';

export interface ResetPasswordTenantLookup {
  readonly id: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly enabled: boolean;
  readonly resetPasswordAllowed: boolean;
}

export interface ResetPasswordRouteDeps {
  readonly database: DatabaseHandle;
  readonly findTenant: (name: string) => Promise<ResetPasswordTenantLookup | null>;
  // Operator configuration (ODUDU_PUBLIC_BASE_URL), never anything read off
  // the request — see #/view/routes/registration.ts for why. Undefined
  // when unset; requestPasswordReset then refuses to send for any tenant
  // rather than building a link some other way.
  readonly publicBaseUrl: string | undefined;
  readonly findByEmail: (
    tx: TenantScopedDatabase,
    email: string,
  ) => Promise<{ subjectId: string; email: string } | null>;
}

// @fastify/formbody parses a repeated field into an array; a repeat is
// treated as absent rather than silently picking one, the same rule
// #/view/routes/registration.ts's firstNonEmptyString applies.
function firstNonEmptyString(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}

function tenantIsOpenForReset(
  tenant: ResetPasswordTenantLookup | null,
): tenant is ResetPasswordTenantLookup {
  return tenant !== null && tenant.enabled && tenant.resetPasswordAllowed;
}

// Not under /protocol/openid-connect/: this is Odudu's own account UI, the
// same namespace choice #/view/routes/registration.ts documents. A tenant
// with reset_password_allowed off (the default) serves nothing here at
// all — 404 on the form and on the submission alike, the same way a
// disabled tenant refuses registration.
export function registerResetPasswordRoute(
  app: FastifyInstance,
  deps: ResetPasswordRouteDeps,
): void {
  app.get<{ Params: { tenant: string } }>(
    '/tenants/:tenant/login-actions/reset-password',
    async (request, reply) => {
      const tenant = await deps.findTenant(request.params.tenant);
      if (!tenantIsOpenForReset(tenant)) {
        return reply.code(404).send();
      }
      return sendResetHtml(reply, 200, renderResetRequestForm(request.params.tenant));
    },
  );

  app.post<{
    Params: { tenant: string };
    Body: Record<string, string | string[] | undefined>;
  }>('/tenants/:tenant/login-actions/reset-password', async (request, reply) => {
    const tenant = await deps.findTenant(request.params.tenant);
    if (!tenantIsOpenForReset(tenant)) {
      return reply.code(404).send();
    }

    const email = firstNonEmptyString(request.body.email);
    if (email === undefined) {
      return sendResetHtml(reply, 400, renderResetRequestFailedPage('Email is required.'));
    }

    // Composed before the lookup happens, and reached whether or not the
    // address matches an account — see requestPasswordReset for why: the
    // property this whole flow exists for is that these two paths cannot
    // be told apart from the response.
    const outcome = await requestPasswordReset(
      {
        database: deps.database,
        tenantId: tenant.id,
        tenantName: tenant.name,
        tenantDisplayName: tenant.displayName ?? tenant.name,
        issuerBase: deps.publicBaseUrl,
        findByEmail: deps.findByEmail,
      },
      email,
    );

    if (outcome.kind === 'misconfigured') {
      request.log.error(
        { tenant: request.params.tenant },
        'password reset refused: ODUDU_PUBLIC_BASE_URL is unset',
      );
      return sendResetHtml(
        reply,
        500,
        renderResetRequestFailedPage('Password reset is temporarily unavailable. Try again later.'),
      );
    }

    return sendResetHtml(reply, 200, renderResetRequestedPage());
  });
}
