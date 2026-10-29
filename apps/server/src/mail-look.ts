import { withSavepoint, type TenantScopedDatabase } from '@odudu/db';
import { messageOverrideRepository } from '@odudu/domain-tenant';
import {
  isMailMessageKey,
  MAIL_MESSAGES,
  type MailLookResolver,
  type MailOverrides,
  type MailTenantScope,
} from '@odudu/email';
import { type MailBranding } from '@odudu/kernel';

export type MailThemeResolver = (
  tx: TenantScopedDatabase,
  scope: MailTenantScope,
) => Promise<MailBranding | null>;

// The tenant's wording for the mail messages, in the transaction the mail is
// queued in: one statement for every language, so what a mail costs does not
// depend on whose language it turns out to be, and only the mail keys are
// selected. It reads in a savepoint, so a statement that fails leaves the
// transaction usable for the mail that is written in it.
export function readMailOverrides(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<MailOverrides> {
  return withSavepoint(tx, (inner) =>
    messageOverrideRepository(inner, { isKnownKey: isMailMessageKey }).forMail(
      tenantId,
      Object.keys(MAIL_MESSAGES),
    ),
  );
}

export interface MailLookDeps {
  theme: MailThemeResolver;
  log: (problem: { tenantId: string; what: string; error: string }) => void;
  readOverrides?: (tx: TenantScopedDatabase, tenantId: string) => Promise<MailOverrides>;
}

// What a queued mail is dressed and worded with: the theme the pages use (the
// client's over the tenant's when the flow began inside one) and the tenant's
// message overrides. Each is read so that the other failing does
// not take it down, and a failure is logged with the tenant and the kind of
// error, never with text the tenant wrote.
export function createMailLook(deps: MailLookDeps): MailLookResolver {
  const readOverrides = deps.readOverrides ?? readMailOverrides;
  const failed = (tenantId: string, what: string, error: unknown): void => {
    deps.log({ tenantId, what, error: error instanceof Error ? error.name : typeof error });
  };
  return async (tx, scope) => {
    let branding: MailBranding | null = null;
    try {
      branding = await deps.theme(tx, scope);
    } catch (error) {
      failed(scope.tenantId, 'theme', error);
      if (scope.clientId !== undefined && scope.clientId !== null) {
        try {
          branding = await deps.theme(tx, { ...scope, clientId: null });
        } catch (again) {
          failed(scope.tenantId, 'theme', again);
        }
      }
    }
    if (scope.wording === false) return { branding, overrides: {} };
    try {
      return { branding, overrides: await readOverrides(tx, scope.tenantId) };
    } catch (error) {
      failed(scope.tenantId, 'wording', error);
      return { branding, overrides: {} };
    }
  };
}
