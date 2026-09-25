import type { Logger } from '@odudu/kernel';
import type { EmailMessage, EmailSender } from '#/service/sender';

/**
 * What a deployment with no SMTP host sends through: each message is
 * written to the log — so a developer running the compose stack can read a
 * verification link — and then dropped. Retains nothing, which is the
 * difference that matters from `capturingSender`: this sender lives for
 * the whole process, and holding every verification and reset mail until
 * restart is a leak nothing reads back. Logs the same line the capturing
 * adapter does, so a transcript or a grep for it still finds the message.
 */
export function loggingSender(logger: Logger): EmailSender {
  return {
    send(message: EmailMessage): Promise<void> {
      logger.info(
        { to: message.to, subject: message.subject, text: message.text, html: message.html },
        'captured email — no SMTP host configured',
      );
      return Promise.resolve();
    },
  };
}
