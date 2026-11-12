import { type TenantScopedDatabase } from '@odudu/db';
import { userRepository } from '@odudu/domain-identity';
import {
  noticeAddressOf,
  queueOwnChangeNotice,
  type MailLookResolver,
  type NoticeOutcome,
  type OwnChange,
} from '@odudu/email';

// Tells the subject, in the transaction that made the change, that they made
// it; the outcome is what the change's audit row records as `notice`.
export async function noticeOwnChange(
  tx: TenantScopedDatabase,
  input: { tenantId: string; subjectId: string; now: Date },
  change: OwnChange,
  resolveMailLook: MailLookResolver | undefined,
): Promise<NoticeOutcome> {
  const user = await userRepository(tx).bySubjectId(input.subjectId);
  return queueOwnChangeNotice(
    tx,
    { tenantId: input.tenantId, address: noticeAddressOf(user), now: input.now },
    change,
    resolveMailLook,
  );
}
