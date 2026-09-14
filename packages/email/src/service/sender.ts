export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

// A port, so the SMTP client is one adapter and the test double is another.
// `send` resolves when the message has been handed to the transport; it
// makes no claim about delivery, which no SMTP client can make either.
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
