import type { Logger } from '@odudu/kernel';
import type { EmailMessage, EmailSender } from '#/service/sender';

const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => noopLogger,
};

// Keeps the test suite and the compose stack free of a mail server: it
// records every message in memory (for assertions) and writes it to the
// given logger (so a developer running the stack can read a verification
// link without one).
export function capturingSender(
  logger: Logger = noopLogger,
): EmailSender & { readonly sent: readonly EmailMessage[] } {
  const sent: EmailMessage[] = [];

  return {
    sent,
    send(message: EmailMessage): Promise<void> {
      sent.push(message);
      logger.info(
        { to: message.to, subject: message.subject, text: message.text, html: message.html },
        'captured email — no SMTP host configured',
      );
      return Promise.resolve();
    },
  };
}
