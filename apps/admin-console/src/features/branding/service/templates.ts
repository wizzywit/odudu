import { MAX_TEMPLATE_BYTES, THEME_PAGE_KINDS } from '@odudu/contracts';
import {
  detailed,
  NO_PROBLEMS,
  placedProblems,
  type PlacedProblems,
} from '#/features/branding/service/problems';
import { bytesText } from '#/shared/service/format';
import type { PublishOutcome } from '#/features/branding/service/edits';
import type { PageKind } from '#/features/branding/service/values';
import type { FieldError } from '@odudu/contracts/admin';

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

const FORM = ['form.open', 'form.close'];

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

export const TEMPLATES_INTRO =
  'A template is the HTML of one page. Leave it empty to use the layer below. The server fills in every part itself; a template only decides where each one sits.';

export const MESSAGE_NOTE =
  'Wording comes from the catalogue: {{t "key"}} inserts the message with that key in the visitor’s language. A key the page’s catalogue does not have is refused when you save.';

export const TEMPLATE_RULES =
  'Plain HTML only. Scripts, styles, forms, inputs, frames and event attributes are refused, and links must be https.';

export const TEMPLATE_LABEL = 'Template';

export function templateDescription(): string {
  return `Up to ${bytesText(MAX_TEMPLATE_BYTES)}. Empty uses the layer below.`;
}

export const PARTS_TITLE = 'Parts of this page';

export const REQUIRED_NOTE = 'Required, each exactly once:';

export const OPTIONAL_NOTE = 'Optional, at most once:';

export function formNote(manifest: Manifest): string | null {
  const inside = manifest.inForm.map(slot).join(', ');
  return inside === ''
    ? null
    : `Between ${slot(FORM[0] ?? '')} and ${slot(FORM[1] ?? '')}: ${inside}.`;
}

export const TEMPLATE_REFUSED = 'The template was not saved.';

export const TEMPLATE_UNPUBLISHABLE = 'The saved template was refused at publish.';

// What a refused save says about one page's template.
export function templateProblems(
  kind: PageKind,
  errors: readonly FieldError[],
  saved: string | undefined,
): PlacedProblems {
  return placedProblems(errors, saved, {
    path: `templates.${kind}`,
    refused: TEMPLATE_REFUSED,
    wording: (error) => detailed(error.message, error),
  });
}

// What a refused publish says about one page's template, for as long as the
// draft it refused is the one on screen.
export function publishedTemplateProblems(
  kind: PageKind,
  outcome: PublishOutcome,
  tag: string,
  changed: boolean,
): PlacedProblems {
  if (changed || outcome.atTag !== tag) return NO_PROBLEMS;
  return placedProblems(outcome.errors, undefined, {
    path: `templates.${kind}`,
    refused: TEMPLATE_UNPUBLISHABLE,
    wording: (error) => detailed(error.message, error),
  });
}

export const SCRIPT_NOTE =
  'This page uses a script, which the preview leaves out. The real page runs it.';

// What the preview of a kind leaves out, when it leaves anything.
export function omissionNote(kind: PageKind): string | null {
  return MANIFESTS[kind].required.includes('script') ? SCRIPT_NOTE : null;
}
