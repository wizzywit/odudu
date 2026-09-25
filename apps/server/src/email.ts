import { withTenant, type Database } from '@odudu/db';
import { loggingSender, smtpSender, type EmailMessage, type EmailSender } from '@odudu/email';
import { OduduError, type Config } from '@odudu/kernel';
import {
  resolveHostAddresses,
  smtpSenderFromRecord,
  tenantSmtpRepository,
  type SmtpDestinationPolicy,
} from '@odudu/protocol-admin';
import { type Logger as PinoLogger } from 'pino';

// A tenant with verify_email off needs no mail at all, and the compose
// stack serves plain HTTP on loopback with nothing to relay through — so an
// unset ODUDU_SMTP_HOST selects the log-only adapter rather than refusing
// to boot. loadConfig's own check already refuses ODUDU_SMTP_HOST without
// ODUDU_SMTP_FROM, so that combination cannot reach here.
// `kind` is what a caller (and this file's own tests) tells the three
// outcomes apart by — the resolved sender itself is used identically no
// matter which one it is.
export type ResolvedSender = EmailSender & ({ kind: 'smtp'; host: string } | { kind: 'logging' });

// This is the deployment-level decision: it depends only on config that
// cannot change per tick, so a caller builds it once at boot and hands the
// result to resolveSender rather than letting each resolution rediscover
// ODUDU_SMTP_HOST for itself.
export function buildEmailSender(config: Config, logger: PinoLogger): ResolvedSender {
  if (config.ODUDU_SMTP_HOST === undefined || config.ODUDU_SMTP_FROM === undefined) {
    logger.info({}, 'ODUDU_SMTP_HOST is unset; capturing outgoing mail instead of sending it');
    const sender = loggingSender(logger);
    return { kind: 'logging', send: (message: EmailMessage) => sender.send(message) };
  }

  const sender = smtpSender({
    host: config.ODUDU_SMTP_HOST,
    port: config.ODUDU_SMTP_PORT,
    from: config.ODUDU_SMTP_FROM,
    ...(config.ODUDU_SMTP_USERNAME !== undefined ? { username: config.ODUDU_SMTP_USERNAME } : {}),
    ...(config.ODUDU_SMTP_PASSWORD !== undefined ? { password: config.ODUDU_SMTP_PASSWORD } : {}),
    starttls: config.ODUDU_SMTP_STARTTLS,
  });
  return {
    kind: 'smtp',
    host: config.ODUDU_SMTP_HOST,
    send: (message: EmailMessage) => sender.send(message),
  };
}

export interface ResolveSenderDeps {
  readonly database: Database;
  readonly kek: Uint8Array;
  // Decided once at boot by buildEmailSender; resolveSender never
  // re-derives it, so an unset ODUDU_SMTP_HOST is discovered once rather
  // than on every message.
  readonly fallback: ResolvedSender;
  readonly smtpDestination: SmtpDestinationPolicy;
}

export function smtpDestinationPolicyFor(config: Config): SmtpDestinationPolicy {
  return {
    allowPrivate: config.ODUDU_ALLOW_PRIVATE_SMTP_HOSTS,
    resolve: resolveHostAddresses,
  };
}

// The resolution order a tenant's own outgoing mail follows: its own
// tenant_smtp row (packages/protocol-admin/src/repository/tenant-smtp.ts),
// else the deployment's own already-resolved fallback. ADR 0015 is
// unaffected: it governs where a deployment's own credentials live, and a
// tenant's row is a credential the deployment never holds.
export async function resolveSender(
  deps: ResolveSenderDeps,
  tenantId: string,
): Promise<ResolvedSender> {
  const record = await withTenant(deps.database, tenantId, (tx) =>
    tenantSmtpRepository(tx).byTenantId(tenantId),
  );
  if (record === null) {
    return deps.fallback;
  }

  // A refused destination is not a reason to send this tenant's mail from
  // the deployment's own relay: that would deliver it from somewhere the
  // tenant never configured. The pass counts this tenant's batch failed
  // and moves on (`sendPending`, @odudu/email).
  const built = await smtpSenderFromRecord(record, deps.kek, deps.smtpDestination);
  if (built.kind === 'refused_destination') {
    throw new OduduError('smtp_destination_refused', built.reason);
  }
  return {
    kind: 'smtp',
    host: record.host,
    send: (message: EmailMessage) => built.sender.send(message),
  };
}
