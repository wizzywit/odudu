import { type RequiredAction } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { tenantSmtpRepository } from '#/repository/tenant-smtp';

/** What a link does: one of the two self-service links, or one taking its subject through actions. */
export type AccountLinkPurpose =
  | { readonly kind: 'reset_password' }
  | { readonly kind: 'verify_email' }
  | {
      readonly kind: 'execute_actions';
      readonly actions: readonly RequiredAction[];
    };

/** What a link is minted for and who it goes to; the minting is @odudu/account's. */
export type AccountLinkRequest = AccountLinkPurpose & AccountLinkAddress;

interface AccountLinkAddress {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantDisplayName: string;
  readonly subjectId: string;
  readonly email: string;
  readonly locale: string | null;
  /** The client, by its internal id, and the registered address the link returns to. */
  readonly returnTo?: { readonly clientId: string; readonly uri: string } | undefined;
}

/**
 * Mints the link and queues the mail carrying it, in the caller's
 * transaction, through the same write a self-service request makes.
 * `unavailable` when the deployment has no public base URL to put in it.
 */
export type SendAccountLink = (
  tx: TenantScopedDatabase,
  request: AccountLinkRequest,
) => Promise<'queued' | 'unavailable'>;

// Mail that is only ever written to the log (`GET …/smtp`'s `none`) is not sent.
export async function canSendMail(
  tx: TenantScopedDatabase,
  tenantId: string,
  deploymentSmtp: boolean,
): Promise<boolean> {
  return deploymentSmtp || (await tenantSmtpRepository(tx).byTenantId(tenantId)) !== null;
}
