import { fieldErrorsOf, type FieldErrors } from '#/shared/service/fieldErrors.ts';
import { counted } from '#/shared/service/format.ts';
import type { GatewayFailure } from '#/shared/service/result.ts';

export interface MailRefusal {
  text: string;
  // Where it is put right.
  fix: 'profile' | 'email' | 'settings';
}

// The three conflicts a mail meets before it is sent, each one a fact about
// the subject or the tenant rather than a guard.
export function mailRefusal(type: string, name: string): MailRefusal | null {
  switch (type) {
    case 'about:blank#no-email':
      return { text: `${name} has no email address. Add one under Profile first.`, fix: 'profile' };
    case 'about:blank#no-mail-relay':
      return {
        text: 'The tenant has no mail relay and the deployment no sender, so the mail would only be logged. Set up a relay under Email.',
        fix: 'email',
      };
    case 'about:blank#reset-password-off':
      return {
        text: 'Password reset is off for this tenant, so its reset page would refuse the link. Turn it on in Settings.',
        fix: 'settings',
      };
    default:
      return null;
  }
}

export type MailKind = 'reset' | 'verification' | 'actions';

export interface MailOutcome {
  sent: boolean;
  text: string;
  // Where the refusal is put right, when it is a fact about the tenant or subject.
  fix: { label: string; href: string } | null;
}

const MAIL_FIX_LABEL: Readonly<Record<MailRefusal['fix'], string>> = {
  profile: 'Profile',
  email: 'Email',
  settings: 'Settings',
};

export function mailOutcome(
  failure: GatewayFailure,
  name: string,
  hrefs: Readonly<Record<MailRefusal['fix'], string>>,
): MailOutcome {
  switch (failure.kind) {
    case 'network':
      return {
        sent: false,
        text: 'Could not confirm the mail was sent. It has not been asked for again; nothing shows whether it went, so ask again only if it is still owed.',
        fix: null,
      };
    case 'schema':
      return {
        sent: true,
        text: 'The mail was asked for, but the answer could not be read.',
        fix: null,
      };
    case 'defect':
      return {
        sent: false,
        text: 'The console could not finish. This is a fault in the console, not something you did.',
        fix: null,
      };
    case 'problem': {
      const said = mailRefusal(failure.problem.type, name);
      if (said !== null) {
        return {
          sent: false,
          text: said.text,
          fix: { label: MAIL_FIX_LABEL[said.fix], href: hrefs[said.fix] },
        };
      }
      if (failure.problem.status === 403) {
        return {
          sent: false,
          text: `Refused: it needs the manage-users capability, or ${name} holds an admin capability you do not.`,
          fix: null,
        };
      }
      return {
        sent: false,
        text: `Not sent: ${failure.problem.detail ?? failure.problem.title}`,
        fix: null,
      };
    }
  }
}

// Only the actions mail has a field a 400 can name.
export function mailFieldErrors(kind: MailKind, failure: GatewayFailure): FieldErrors | null {
  if (kind !== 'actions' || failure.kind !== 'problem' || failure.problem.status !== 400) {
    return null;
  }
  return fieldErrorsOf(failure.problem, ['actions']);
}

// A 400 the field errors fully explain shows no outcome beside them.
export function mailFailure(
  kind: MailKind,
  failure: GatewayFailure,
  name: string,
  hrefs: Readonly<Record<MailRefusal['fix'], string>>,
): { errors: FieldErrors['fields'] | null; outcome: MailOutcome | null } {
  const placed = mailFieldErrors(kind, failure);
  if (placed !== null && placed.other.length === 0) return { errors: placed.fields, outcome: null };
  return {
    errors: placed === null ? null : placed.fields,
    outcome: mailOutcome(failure, name, hrefs),
  };
}

export function mailSentText(kind: MailKind, email: string | null, count = 0): string {
  const address = email ?? 'their address';
  switch (kind) {
    case 'reset':
      return `A password reset link was sent to ${address}.`;
    case 'verification':
      return `A verification link was sent to ${address}.`;
    case 'actions':
      return `A link through ${counted(count, 'action', 'actions')} was sent to ${address}. Following it asks for each, in order.`;
  }
}
