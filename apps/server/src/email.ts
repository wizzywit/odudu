import { capturingSender, smtpSender, type EmailSender } from '@odudu/email';
import { type Config } from '@odudu/kernel';
import { type Logger as PinoLogger } from 'pino';

// A realm with verify_email off needs no mail at all, and the compose
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
