import { THEME_PAGE_KINDS } from '@odudu/contracts';

export const PAGE_KIND_LABELS: Readonly<Record<PageKind, string>> = {
  'sign-in': 'Sign in',
  consent: 'Consent',
  'select-account': 'Choose an account',
  'logout-confirm': 'Confirm sign-out',
  'totp-enrolment': 'Authenticator app set-up',
  'passkey-enrolment': 'Passkey set-up',
  'recovery-codes': 'Recovery codes',
  'update-password': 'Change password',
  'required-action': 'Required action',
  registration: 'Registration',
  reset: 'Password reset',
  verification: 'Email verification',
  'required-actions': 'Required actions',
  'authorize-error': 'Sign-in error',
  'email-unverified': 'Email not verified',
  'logged-out': 'Signed out',
  notice: 'Notice',
};

export const PAGE_KIND_OPTIONS: readonly { id: PageKind; label: string }[] = THEME_PAGE_KINDS.map(
  (kind) => ({ id: kind, label: PAGE_KIND_LABELS[kind] }),
);

export function pageKindOf(name: string): PageKind | undefined {
  return THEME_PAGE_KINDS.find((kind) => kind === name);
}

export interface Manifest {
  required: readonly string[];
  optional: readonly string[];
  // Parts that sit between the form's open and close when they appear.
  inForm: readonly string[];
}

// What the server emits for each page kind; a template places these parts and
// may add none of its own. A test holds the table to the server's own.
export const MANIFESTS: Readonly<Record<PageKind, Manifest>> = {
  'sign-in': {
    required: ['form.open', 'fields', 'submit', 'error', 'form.close'],
    optional: ['intro', 'links', 'passkey'],
    inForm: ['fields', 'submit'],
  },
  consent: {
    required: ['form.open', 'client', 'scopes', 'submit.allow', 'submit.deny', 'form.close'],
    optional: ['error', 'links'],
    inForm: ['scopes', 'submit.allow', 'submit.deny'],
  },
  'select-account': {
    required: ['form.open', 'accounts', 'submit.other', 'form.close'],
    optional: ['intro'],
    inForm: ['accounts', 'submit.other'],
  },
  'logout-confirm': {
    required: ['form.open', 'submit', 'form.close'],
    optional: [],
    inForm: ['submit'],
  },
  'totp-enrolment': {
    required: ['form.open', 'offer', 'fields', 'submit', 'error', 'form.close'],
    optional: ['intro'],
    inForm: ['fields', 'submit'],
  },
  'passkey-enrolment': {
    required: ['form.open', 'fields', 'submit', 'error', 'script', 'form.close'],
    optional: ['intro'],
    inForm: ['fields', 'submit'],
  },
  'recovery-codes': {
    required: ['instructions', 'codes', 'notice', 'form.open', 'submit', 'error', 'form.close'],
    optional: ['intro'],
    inForm: ['submit'],
  },
  'update-password': {
    required: ['form.open', 'fields', 'submit', 'error', 'form.close'],
    optional: ['intro'],
    inForm: ['fields', 'submit'],
  },
  'required-action': { required: ['message'], optional: [], inForm: [] },
  registration: {
    required: ['form.open', 'fields', 'submit', 'error', 'form.close'],
    optional: ['intro', 'links'],
    inForm: ['fields', 'submit'],
  },
  reset: {
    required: ['form.open', 'fields', 'submit', 'error', 'form.close'],
    optional: ['intro', 'links'],
    inForm: ['fields', 'submit'],
  },
  verification: {
    required: ['message', 'form.open', 'submit', 'form.close'],
    optional: [],
    inForm: ['submit'],
  },
  'required-actions': {
    required: ['form.open', 'actions', 'fields', 'submit', 'error', 'form.close'],
    optional: ['intro'],
    inForm: ['fields', 'submit'],
  },
  'authorize-error': { required: ['message'], optional: ['links', 'code'], inForm: [] },
  'email-unverified': { required: ['message'], optional: ['links'], inForm: [] },
  'logged-out': { required: ['message', 'frames', 'script'], optional: ['links'], inForm: [] },
  notice: { required: ['message'], optional: ['intro', 'links'], inForm: [] },
};

export function slot(part: string): string {
  return `{{${part}}}`;
}

export type PageKind = (typeof THEME_PAGE_KINDS)[number];

export const PAGES_LEAD =
  'Choose a page, then change its layout. The preview shows the page as people see it.';

export const PAGE_PICKER_LABEL = 'Page';

export function pickLabel(label: string): string {
  return `Pick ${label.toLowerCase()}`;
}

// Hands on the kind a control's id names, nothing for any other.
export function chooseKind(id: string, choose: (kind: PageKind) => void): void {
  const kind = pageKindOf(id);
  if (kind !== undefined) choose(kind);
}
