// What the server emits for each page kind, by slot name. `required` parts
// each appear in a template exactly once; `optional` ones at most once. A
// template can hold no <form>, so the form's open and close tags are parts.
export type PageKind =
  | 'sign-in'
  | 'consent'
  | 'select-account'
  | 'logout-confirm'
  | 'totp-enrolment'
  | 'passkey-enrolment'
  | 'recovery-codes'
  | 'update-password'
  | 'required-action'
  | 'registration'
  | 'reset'
  | 'verification'
  | 'required-actions'
  | 'authorize-error'
  | 'email-unverified'
  | 'logged-out'
  | 'notice';

export interface PageManifest {
  readonly required: readonly string[];
  readonly optional: readonly string[];
  // Parts that must sit between form.open and form.close when they appear.
  readonly inForm: readonly string[];
}

const FORM_OPEN = 'form.open';
const FORM_CLOSE = 'form.close';

// `form.open` carries every hidden field the form posts, the proof included,
// so a template cannot drop or forge one. `fields` is one slot where the
// inputs depend on the step. `intro` is the heading with the tenant; on
// `consent` it names the client, so it is the required `client`. A form's
// `error` is required so a refusal cannot be hidden, and a part a page may
// have nothing for (`error`, `frames`, `script`, `notice`) is placed empty.
// A script travels with the elements it reads, in the one `script` part.
// Pages outside any tenant have no kind.
export const PAGE_KINDS: Record<PageKind, PageManifest> = {
  'sign-in': {
    required: [FORM_OPEN, 'fields', 'submit', 'error', FORM_CLOSE],
    optional: ['intro', 'links', 'passkey'],
    inForm: ['fields', 'submit'],
  },
  consent: {
    required: [FORM_OPEN, 'client', 'scopes', 'submit.allow', 'submit.deny', FORM_CLOSE],
    optional: ['error', 'links'],
    inForm: ['scopes', 'submit.allow', 'submit.deny'],
  },
  'select-account': {
    required: [FORM_OPEN, 'accounts', 'submit.other', FORM_CLOSE],
    optional: ['intro'],
    inForm: ['accounts', 'submit.other'],
  },
  'logout-confirm': {
    required: [FORM_OPEN, 'submit', FORM_CLOSE],
    optional: [],
    inForm: ['submit'],
  },
  'totp-enrolment': {
    required: [FORM_OPEN, 'offer', 'fields', 'submit', 'error', FORM_CLOSE],
    optional: ['intro'],
    inForm: ['fields', 'submit'],
  },
  'passkey-enrolment': {
    required: [FORM_OPEN, 'fields', 'submit', 'error', 'script', FORM_CLOSE],
    optional: ['intro'],
    inForm: ['fields', 'submit'],
  },
  'recovery-codes': {
    required: ['instructions', 'codes', 'notice', FORM_OPEN, 'submit', 'error', FORM_CLOSE],
    optional: ['intro'],
    inForm: ['submit'],
  },
  'update-password': {
    required: [FORM_OPEN, 'fields', 'submit', 'error', FORM_CLOSE],
    optional: ['intro'],
    inForm: ['fields', 'submit'],
  },
  'required-action': { required: ['message'], optional: [], inForm: [] },
  registration: {
    required: [FORM_OPEN, 'fields', 'submit', 'error', FORM_CLOSE],
    optional: ['intro', 'links'],
    inForm: ['fields', 'submit'],
  },
  reset: {
    required: [FORM_OPEN, 'fields', 'submit', 'error', FORM_CLOSE],
    optional: ['intro', 'links'],
    inForm: ['fields', 'submit'],
  },
  verification: {
    required: ['message', FORM_OPEN, 'submit', FORM_CLOSE],
    optional: [],
    inForm: ['submit'],
  },
  'required-actions': {
    required: [FORM_OPEN, 'actions', 'fields', 'submit', 'error', FORM_CLOSE],
    optional: ['intro'],
    inForm: ['fields', 'submit'],
  },
  'authorize-error': { required: ['message'], optional: ['links', 'code'], inForm: [] },
  'email-unverified': { required: ['message'], optional: ['links'], inForm: [] },
  'logged-out': {
    required: ['message', 'frames', 'script'],
    optional: ['links'],
    inForm: [],
  },
  // An outcome with nothing to submit: `message` holds the heading, the text
  // and the way on when there is one, so a theme cannot drop it; `links` are
  // the secondary ways back.
  notice: { required: ['message'], optional: ['intro', 'links'], inForm: [] },
};
