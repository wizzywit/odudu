import { PAGE_KINDS, type PageKind } from '@odudu/kernel';
import { stylesheetHooks } from '@odudu/protocol-admin/docs';
import { codeCell, page, table } from './markdown.ts';

// Keyed by PageKind so a page kind added to the server fails the build here
// until it is described.
const KIND_DESCRIPTIONS: Record<PageKind, string> = {
  'sign-in': 'The sign-in page.',
  consent: 'The page that asks a person to approve what an app requests.',
  'select-account': 'The page that offers the accounts already signed in at this browser.',
  'logout-confirm': 'The question asked before ending a session at the end-session address.',
  'totp-enrolment': 'Adding an authenticator app.',
  'passkey-enrolment': 'Adding a passkey.',
  'recovery-codes': 'Showing the new recovery codes once.',
  'update-password': 'Choosing a new password when one is required.',
  'required-action': 'A step required before sign-in can finish, with no page of its own.',
  registration: 'Creating an account.',
  reset: 'Asking for, and then choosing, a new password.',
  verification: 'Confirming an email address.',
  'required-actions': 'Several required steps on one page.',
  'authorize-error': 'A sign-in request that cannot go on and cannot be sent back to the app.',
  'email-unverified': 'A person whose email address is not yet confirmed.',
  'logged-out': 'The page shown after a sign-out.',
  notice: 'An outcome with nothing to submit.',
};

export const PART_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'form.open':
    'The form’s opening tag with every hidden field it posts, the anti-forgery proof included.',
  'form.close': 'The form’s closing tag.',
  fields: 'The inputs for the current step.',
  submit: 'The button that sends the form.',
  'submit.allow': 'The button that approves the request.',
  'submit.deny': 'The button that refuses it.',
  'submit.other': 'The button that signs in as someone else.',
  error: 'The refusal message for the form; empty when there is none.',
  intro: 'The heading and the tenant’s name.',
  links: 'The ways on: back to sign-in, to registration or to a reset.',
  passkey: 'The passkey control, when the tenant offers passkeys.',
  client: 'The name of the app that is asking.',
  scopes: 'What the app is asking for.',
  accounts: 'The accounts that can be chosen.',
  offer: 'What the person needs to add the authenticator.',
  instructions: 'How to keep the codes.',
  codes: 'The recovery codes.',
  notice: 'A notice the page may or may not carry.',
  message: 'The heading, the text and the way on when there is one.',
  actions: 'The steps still to do.',
  code: 'The error code the person can quote.',
  frames: 'The logout frames some apps need; empty when there are none.',
  script: 'The script the page needs, together with the elements it reads.',
};

function slot(part: string): string {
  return codeCell(`{{${part}}}`);
}

function list(parts: readonly string[]): string {
  return parts.length === 0 ? 'none' : parts.map(slot).join(', ');
}

const kinds = (): PageKind[] => Object.keys(PAGE_KINDS) as PageKind[];

function partsSection(): string {
  const rows = kinds().map((kind) => {
    const manifest = PAGE_KINDS[kind];
    return [
      codeCell(kind),
      KIND_DESCRIPTIONS[kind],
      list(manifest.required),
      list(manifest.optional),
    ];
  });
  const parts = [
    ...new Set(Object.values(PAGE_KINDS).flatMap((m) => [...m.required, ...m.optional])),
  ].sort();
  return [
    '## Page kinds and their parts',
    'A template for a page kind places the parts the server fills in. Each required part appears exactly once and each optional part at most once. Where `{{form.open}}` and `{{form.close}}` are required they come in that order, and every part that belongs in the form sits between them.',
    table(['Page kind', 'Page', 'Required parts', 'Optional parts'], rows),
    '### What each part holds',
    table(
      ['Part', 'Holds'],
      parts.map((part) => [slot(part), PART_DESCRIPTIONS[part] ?? '']),
    ),
  ].join('\n\n');
}

function inForm(): string {
  const rows = kinds()
    .filter((kind) => PAGE_KINDS[kind].inForm.length > 0)
    .map((kind) => [codeCell(kind), list(PAGE_KINDS[kind].inForm)]);
  return [
    '### Parts that sit inside the form',
    'These parts are refused outside `{{form.open}}` and `{{form.close}}`.',
    table(['Page kind', 'Between the form’s tags'], rows),
  ].join('\n\n');
}

function names(heading: string, intro: string, values: readonly string[], prefix = ''): string {
  return [
    `### ${heading}`,
    intro,
    table(
      ['Name'],
      values.map((value) => [codeCell(`${prefix}${value}`)]),
    ),
  ].join('\n\n');
}

function hooksSection(): string {
  const hooks = stylesheetHooks();
  return [
    '## CSS hooks',
    `A theme’s stylesheet may name only what is listed here, and these are version ${String(hooks.version)} of the list. A hook is renamed or removed only with a new version; adding one does not make a new version. The console’s Selectors you can use shows this same list. A stylesheet cannot define a custom property of its own.`,
    names(
      'Classes the pages render',
      'A rule names a class as a selector, for example `.logo { display: none; }`. `.logo-light` and `.logo-dark` hide one variant of the logo.',
      hooks.classes,
      '.',
    ),
    names(
      'One class for each page kind',
      'Each page carries the class `page-` and its kind, so a rule can style one page alone.',
      hooks.page_kind_classes,
      '.',
    ),
    names('Elements', 'A rule may also name these elements.', hooks.elements),
    names(
      'States',
      'These may follow a selector after one colon or two.',
      hooks.pseudo_classes,
      ':',
    ),
    names(
      'Parts of an element',
      'These may follow a selector after two colons, or one.',
      hooks.pseudo_elements,
      '::',
    ),
    names(
      'Design values',
      'A declaration may read these Instrument values with `var()`.',
      hooks.tokens,
    ),
  ].join('\n\n');
}

export function renderBrandingPage(): string {
  return page(
    'Branding reference',
    'The page kinds and the parts a template places, and the CSS hooks a theme stylesheet may name, listed from the code.',
    [
      'This page is written from the code the server checks a theme with, so it cannot fall behind it. [Branding](../../concepts/branding.mdx) explains how a theme works.',
      partsSection(),
      inForm(),
      hooksSection(),
    ].join('\n\n'),
  );
}
