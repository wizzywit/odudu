import { withSavepoint, type TenantScopedDatabase } from '@odudu/db';
import { messageOverrideRepository } from '@odudu/domain-tenant';
import {
  isMailMessageKey,
  type MailBrandingResolver,
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
// depend on whose language it turns out to be. Only mail keys are kept, and a
// read that fails leaves the catalogue's words rather than the mail unsent.
async function mailOverrides(tx: TenantScopedDatabase, tenantId: string): Promise<MailOverrides> {
  try {
    const held = await withSavepoint(tx, (inner) =>
      messageOverrideRepository(inner, { isKnownKey: isMailMessageKey }).forMail(tenantId),
    );
    return Object.fromEntries(
      Object.entries(held).map(([locale, messages]) => [
        locale,
        Object.fromEntries(Object.entries(messages).filter(([key]) => isMailMessageKey(key))),
      ]),
    );
  } catch {
    return {};
  }
}

// What a queued mail is dressed and worded with: the theme the pages use,
// and the tenant's message overrides, each read so that the other failing
// does not take it down.
export function createMailLook(theme: MailThemeResolver): MailBrandingResolver {
  return async (tx, scope) => {
    let branding: MailBranding | null = null;
    try {
      branding = await theme(tx, scope);
    } catch {
      branding = null;
    }
    return { branding, overrides: await mailOverrides(tx, scope.tenantId) };
  };
}
