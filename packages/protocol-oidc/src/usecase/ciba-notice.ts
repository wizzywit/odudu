import { type TenantScopedDatabase } from '@odudu/db';
import { userRepository } from '@odudu/domain-identity';
import { baseIsTls, canonicalAddressFor, type LookupCanonicalDomain } from '@odudu/domain-tenant';
import {
  noticeAddressOf,
  queueApprovalNotice,
  queueApprovalNoticeDecoy,
  type MailLookResolver,
} from '@odudu/email';
import { addressUrl } from '@odudu/kernel';

// What the mail of an approval is built from. Absent, no mail is queued and
// every path of a request says so alike.
export interface ApprovalMail {
  // The configured public base URL, never a request's own authority: a
  // header a client controls must not decide where a mailed link points.
  readonly issuerBase: string;
  readonly lookupDomain?: LookupCanonicalDomain | undefined;
  readonly resolveMailLook?: MailLookResolver | undefined;
  // Whether an address may be mailed another notice now.
  readonly budgetAllows?: ((tenantId: string, address: string) => boolean) | undefined;
}

// A subject no person holds and an approval nothing holds, for the statements
// a request makes that has no person or no approval to tell.
const NOBODY = '00000000-0000-0000-0000-000000000000';

// Tells the person an approval is waiting. Every request runs the same
// statements: a request for nobody, one for a person at their limit and one
// for a person whose address cannot be mailed read the same rows and insert
// into the same table, the insert matching nothing, so nothing a client can
// observe says which of them it made (docs/protocols/oidc-ciba.md).
export async function noticeOfApproval(
  tx: TenantScopedDatabase,
  deps: {
    readonly tenantId: string;
    readonly tenantName: string;
    readonly mail: ApprovalMail | undefined;
    readonly now: Date;
  },
  input: {
    readonly agent: string;
    readonly subjectId: string | null;
    readonly approvalId: string | null;
  },
): Promise<void> {
  const { mail } = deps;
  if (mail === undefined) return;
  const user = await userRepository(tx).bySubjectId(input.subjectId ?? NOBODY);
  const address = await canonicalAddressFor(
    tx,
    { id: deps.tenantId, name: deps.tenantName },
    mail.issuerBase,
    baseIsTls(mail.issuerBase),
    mail.lookupDomain,
  );
  const notice = {
    tenantId: deps.tenantId,
    address: noticeAddressOf(user),
    link: addressUrl(address, `/approval/${input.approvalId ?? NOBODY}`),
    agent: input.agent,
    now: deps.now,
    ...(mail.budgetAllows === undefined
      ? {}
      : { mailBudgetAllows: (to: string) => mail.budgetAllows?.(deps.tenantId, to) ?? true }),
  };
  if (input.approvalId === null) {
    await queueApprovalNoticeDecoy(tx, notice, mail.resolveMailLook);
  } else {
    await queueApprovalNotice(tx, notice, mail.resolveMailLook);
  }
}
