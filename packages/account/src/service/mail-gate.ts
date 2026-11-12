// Whether a mail may be queued for an address now, one budget for each kind,
// so a flood of one kind cannot silence another: the link of a registration, a
// notice to a held address, a password reset, a proof of a new address, a new
// verification link. The composition root backs it with a bounded in-process
// limiter (apps/server/src/mail-limiter.ts). It decides only whether the mail
// is queued: the response a person gets never depends on it.
export type MailKind = 'registration' | 'held' | 'reset' | 'change' | 'verification';
export type MailGate = (kind: MailKind, tenantId: string, address: string) => boolean;
