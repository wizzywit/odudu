export const TERMS_ACCEPTED_TITLE = 'Terms accepted';

export const TERMS_ACCEPTED_RULE =
  'The version of the tenant’s terms this person accepted, and when, newest first. A person accepts a version when the Accept the terms action asks them to.';

export function termsAcceptedLabel(name: string): string {
  return `Terms ${name} accepted`;
}

export function noTermsAcceptedText(name: string): string {
  return `${name} has accepted no version of the terms.`;
}
