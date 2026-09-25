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
// `testSmtp` below and by apps/server's own sender resolution
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

export interface TestSmtpInput {
  readonly tenantId: string;
  readonly to: string;
}

export interface TestSmtpDeps {
  readonly kek: Uint8Array;
}

export type TestSmtpOutcome =
  { kind: 'not_configured' } | { kind: 'sent' } | { kind: 'send_failed'; detail: string };

// Sends synchronously and reports the transport's own failure, because the
// whole value of this route is telling an operator now rather than letting
// them discover a bad configuration when a user's verification mail
// silently fails later.
export async function testSmtp(
  tx: TenantScopedDatabase,
  deps: TestSmtpDeps,
  input: TestSmtpInput,
): Promise<TestSmtpOutcome> {
  const record = await tenantSmtpRepository(tx).byTenantId(input.tenantId);
  if (record === null) return { kind: 'not_configured' };

  const sender = smtpSenderFromRecord(record, deps.kek);
  try {
    await sender.send({
      to: input.to,
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
