import type { MeAmendProfileRequest } from '@odudu/contracts/me';
import { isEmailAddress } from '@odudu/domain-identity';

export type EmailRequestVerdict =
  | { readonly kind: 'ok'; readonly email: string }
  | { readonly kind: 'invalid'; readonly description: string };

// The address a person asks for must be one the email claim may carry; asking
// for none is not a change of address.
export function checkEmailRequest(value: unknown): EmailRequestVerdict {
  if (value === null) {
    return {
      kind: 'invalid',
      description: 'an address cannot be removed, only changed to another',
    };
  }
  if (typeof value !== 'string') {
    return { kind: 'invalid', description: 'email must be a string' };
  }
  if (!isEmailAddress(value)) {
    return {
      kind: 'invalid',
      description: `${JSON.stringify(value)} is not an address the email claim may carry`,
    };
  }
  return { kind: 'ok', email: value };
}

export type EmailRoute = { readonly kind: 'not_email' } | EmailRequestVerdict;

// Whether a profile edit is a change of address, which is answered 202 and so
// cannot share a request with edits answered 200: the address goes alone.
export function emailRequestOf(body: MeAmendProfileRequest): EmailRoute {
  if (!('email' in body)) return { kind: 'not_email' };
  if (Object.keys(body).length > 1) {
    return { kind: 'invalid', description: 'change the address in a request of its own' };
  }
  return checkEmailRequest(body.email);
}

// The language the proof mail is written in: the person's own, when they have one.
export function proofLocale(user: { readonly locale?: string | null | undefined }): string | null {
  return user.locale ?? null;
}

export type EmailChangePlan =
  | { readonly kind: 'send' }
  | { readonly kind: 'skip'; readonly reason: 'address_in_use' | 'unchanged' | 'throttled' };

// `holder` is the subject that holds the address in the tenant, whatever its
// case, and `withinBudget` whether the address may be mailed again now. The
// request answers the same whichever way this goes, so what each reason means
// is told only in the audit trail.
export function planEmailChange(input: {
  readonly holder: string | null;
  readonly subjectId: string;
  readonly withinBudget: boolean;
}): EmailChangePlan {
  if (input.holder !== null) {
    return {
      kind: 'skip',
      reason: input.holder === input.subjectId ? 'unchanged' : 'address_in_use',
    };
  }
  return input.withinBudget ? { kind: 'send' } : { kind: 'skip', reason: 'throttled' };
}
