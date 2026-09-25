import { withTenant, type Database } from '@odudu/db';
import { capturingSender, smtpSender, type EmailMessage, type EmailSender } from '@odudu/email';
import { type Config } from '@odudu/kernel';
import { smtpSenderFromRecord, tenantSmtpRepository } from '@odudu/protocol-admin';
import { type Logger as PinoLogger } from 'pino';

// A tenant with verify_email off needs no mail at all, and the compose
// stack serves plain HTTP on loopback with nothing to relay through — so an
// unset ODUDU_SMTP_HOST selects the capturing adapter rather than refusing
// to boot. loadConfig's own check already refuses ODUDU_SMTP_HOST without
// ODUDU_SMTP_FROM, so that combination cannot reach here.
export function buildEmailSender(config: Config, logger: PinoLogger): EmailSender {
  if (config.ODUDU_SMTP_HOST === undefined || config.ODUDU_SMTP_FROM === undefined) {
    logger.info({}, 'ODUDU_SMTP_HOST is unset; capturing outgoing mail instead of sending it');
    return capturingSender(logger);
  }

  return smtpSender({
    host: config.ODUDU_SMTP_HOST,
    port: config.ODUDU_SMTP_PORT,
    from: config.ODUDU_SMTP_FROM,
    ...(config.ODUDU_SMTP_USERNAME !== undefined ? { username: config.ODUDU_SMTP_USERNAME } : {}),
    ...(config.ODUDU_SMTP_PASSWORD !== undefined ? { password: config.ODUDU_SMTP_PASSWORD } : {}),
    starttls: config.ODUDU_SMTP_STARTTLS,
  });
}

// `kind` is what a caller (and this file's own tests) tells the three
// outcomes apart by — the resolved sender itself is used identically no
// matter which one it is.
export type ResolvedSender = EmailSender & ({ kind: 'smtp'; host: string } | { kind: 'capturing' });

export interface ResolveSenderDeps {
  readonly database: Database;
  readonly kek: Uint8Array;
  readonly config: Config;
  readonly logger: PinoLogger;
}

// The resolution order a tenant's own outgoing mail follows: its own
// tenant_smtp row (packages/protocol-admin/src/repository/tenant-smtp.ts),
// else this deployment's ODUDU_SMTP_* sender, else the capturing adapter.
// ADR 0015 is unaffected: it governs where a deployment's own credentials
// live, and a tenant's row is a credential the deployment never holds.
export async function resolveSender(
  deps: ResolveSenderDeps,
  tenantId: string,
): Promise<ResolvedSender> {
  const record = await withTenant(deps.database, tenantId, (tx) =>
    tenantSmtpRepository(tx).byTenantId(tenantId),
  );
  if (record !== null) {
    const sender = smtpSenderFromRecord(record, deps.kek);
    return {
      kind: 'smtp',
      host: record.host,
      send: (message: EmailMessage) => sender.send(message),
    };
  }

  if (deps.config.ODUDU_SMTP_HOST !== undefined && deps.config.ODUDU_SMTP_FROM !== undefined) {
    const sender = buildEmailSender(deps.config, deps.logger);
    return {
      kind: 'smtp',
      host: deps.config.ODUDU_SMTP_HOST,
      send: (message: EmailMessage) => sender.send(message),
    };
  }

  const sender = capturingSender(deps.logger);
  return { kind: 'capturing', send: (message: EmailMessage) => sender.send(message) };
}
