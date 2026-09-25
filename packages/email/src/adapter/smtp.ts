import { createTransport } from 'nodemailer';
import type { EmailMessage, EmailSender } from '#/service/sender';

export interface SmtpConfig {
  readonly host: string;
  /**
   * The address a destination check already admitted, where the host was
   * supplied rather than configured by the operator. Set it and nodemailer
   * connects there instead of resolving `host` a second time, which is the
   * half of ADR 0028 a relay reached by name would otherwise lose.
   */
  readonly address?: string;
  readonly port: number;
  readonly from: string;
  readonly username?: string;
  readonly password?: string;
  readonly starttls?: boolean;
}

// Nodemailer's own defaults run to minutes. A host that accepts a
// connection and then stalls would hold the shared outbox pass for every
// other tenant, and a send outliving OUTBOX_CLAIM_LEASE_SECONDS lets a
// second runner reclaim a message still in flight — so the three bounds
// below together stay well inside that lease.
const CONNECTION_TIMEOUT_MS = 10_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 30_000;

export interface SmtpTransportOptions {
  readonly host: string;
  /** Present only when `host` is a pinned address: the name TLS verifies against. */
  readonly servername?: string;
  readonly port: number;
  readonly secure: boolean;
  readonly requireTLS: boolean;
  readonly connectionTimeout: number;
  readonly greetingTimeout: number;
  readonly socketTimeout: number;
  readonly auth?: { readonly user: string; readonly pass: string };
}

/**
 * Exported so the transport's shape is assertable without a mail server.
 * `requireTLS` is not the caller's choice once credentials are in play:
 * `secure: false` plus an unenforced STARTTLS puts a username and password
 * on the wire in cleartext (CWE-319), so any configuration carrying either
 * one gets TLS required regardless of what it asked for.
 */
export function transportOptions(config: SmtpConfig): SmtpTransportOptions {
  const carriesCredentials = config.username !== undefined || config.password !== undefined;
  return {
    host: config.address ?? config.host,
    ...(config.address === undefined ? {} : { servername: config.host }),
    port: config.port,
    secure: false,
    requireTLS: carriesCredentials || (config.starttls ?? false),
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    ...(config.username !== undefined && config.password !== undefined
      ? { auth: { user: config.username, pass: config.password } }
      : {}),
  };
}

export function smtpSender(config: SmtpConfig): EmailSender {
  const transporter = createTransport({ ...transportOptions(config) });

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
