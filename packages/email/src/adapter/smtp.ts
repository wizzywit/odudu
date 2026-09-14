import { createTransport } from 'nodemailer';
import type { EmailMessage, EmailSender } from '#/service/sender';

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly from: string;
  readonly username?: string;
  readonly password?: string;
  readonly starttls?: boolean;
}

export function smtpSender(config: SmtpConfig): EmailSender {
  const transporter = createTransport({
    host: config.host,
    port: config.port,
    secure: false,
    requireTLS: config.starttls ?? false,
    ...(config.username !== undefined && config.password !== undefined
      ? { auth: { user: config.username, pass: config.password } }
      : {}),
  });

  return {
    async send(message: EmailMessage): Promise<void> {
      await transporter.sendMail({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}
