import { unwrapSecret, wrapSecret } from '@odudu/crypto';
import { type TenantScopedDatabase } from '@odudu/db';
import { smtpSender, type EmailSender } from '@odudu/email';
import { type SmtpConfig } from '@odudu/contracts/admin';
import { tenantSmtpRepository, type TenantSmtpRecord } from '#/repository/tenant-smtp';

export interface SmtpAuditEvent {
  readonly action: 'tenant.smtp_set';
  readonly resourceType: 'tenant';
  readonly resourceId: string;
  readonly actorSubjectId: string;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same no-op-until-a-real-sink seam. */
export type Audit = (event: SmtpAuditEvent) => Promise<void>;

function toWireShape(record: TenantSmtpRecord | null): SmtpConfig {
  if (record === null) {
    return {
      configured: false,
      host: null,
      port: null,
      from_address: null,
      username: null,
      password_set: false,
      starttls: null,
    };
  }
  return {
    configured: true,
    host: record.host,
    port: record.port,
    from_address: record.fromAddress,
    username: record.username,
    password_set: record.passwordEncrypted !== null,
    starttls: record.starttls,
  };
}

export async function readSmtp(tx: TenantScopedDatabase, tenantId: string): Promise<SmtpConfig> {
  return toWireShape(await tenantSmtpRepository(tx).byTenantId(tenantId));
}

export interface PutSmtpInput {
  readonly tenantId: string;
  readonly host: string;
  readonly port: number;
  readonly fromAddress: string;
  readonly username: string | null;
  readonly password: string | null;
  readonly starttls: boolean;
  readonly actorSubjectId: string;
}

export interface PutSmtpDeps {
  readonly audit: Audit;
  readonly kek: Uint8Array;
}

export async function putSmtp(
  tx: TenantScopedDatabase,
  deps: PutSmtpDeps,
  input: PutSmtpInput,
): Promise<SmtpConfig> {
  const record = await tenantSmtpRepository(tx).upsert(input.tenantId, {
    host: input.host,
    port: input.port,
    fromAddress: input.fromAddress,
    username: input.username,
    passwordEncrypted: input.password === null ? null : wrapSecret(input.password, deps.kek),
    starttls: input.starttls,
  });

  await deps.audit({
    action: 'tenant.smtp_set',
    resourceType: 'tenant',
    resourceId: input.tenantId,
    actorSubjectId: input.actorSubjectId,
  });

  return toWireShape(record);
}

// The one place a tenant's own row becomes a live transport — shared by
// `sendTestMessage` below and by apps/server's own sender resolution
// (email.ts's `resolveSender`), so a test send and a real one build the
// transport the same way.
export function smtpSenderFromRecord(record: TenantSmtpRecord, kek: Uint8Array): EmailSender {
  return smtpSender({
    host: record.host,
    port: record.port,
    from: record.fromAddress,
    ...(record.username !== null ? { username: record.username } : {}),
    ...(record.passwordEncrypted !== null
      ? { password: unwrapSecret(record.passwordEncrypted, kek) }
      : {}),
    starttls: record.starttls,
  });
}

export type ReadSmtpForTestOutcome =
  { kind: 'not_configured' } | { kind: 'ok'; record: TenantSmtpRecord };

export async function readSmtpForTest(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<ReadSmtpForTestOutcome> {
  const record = await tenantSmtpRepository(tx).byTenantId(tenantId);
  return record === null ? { kind: 'not_configured' } : { kind: 'ok', record };
}

export type SendTestMessageOutcome = { kind: 'sent' } | { kind: 'send_failed'; detail: string };

// Takes the record already read, never a transaction: the caller reads
// inside withTenant (readSmtpForTest above) and calls this only after that
// transaction has returned, so an unreachable or slow host never holds a
// pooled tenant connection for the length of the attempt. Sends
// synchronously and reports the transport's own failure, because the whole
// value of this route is telling an operator now rather than letting them
// discover a bad configuration when a user's verification mail silently
// fails later.
export async function sendTestMessage(
  record: TenantSmtpRecord,
  kek: Uint8Array,
  to: string,
): Promise<SendTestMessageOutcome> {
  const sender = smtpSenderFromRecord(record, kek);
  try {
    await sender.send({
      to,
      subject: 'Odudu SMTP test',
      text: 'This is a test message from Odudu.',
      html: '<p>This is a test message from Odudu.</p>',
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: 'send_failed', detail };
  }
  return { kind: 'sent' };
}
