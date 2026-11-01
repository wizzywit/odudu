// The server pages the landing page photographs, and what each one renders
// to. pnpm page-shots takes the pictures; a unit test compares a hash of the
// markup and the stylesheet with the one stored beside the pictures.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_PAGE_LOCALE,
  withBranding,
  type PageLocale,
  type RenderedPage,
} from '@odudu/kernel';
import { renderRegistrationForm } from '../../../../packages/account/src/view/registration-html.ts';
import { renderResetRequestForm } from '../../../../packages/account/src/view/reset-html.ts';
import { renderLoginForm } from '../../../../packages/protocol-oidc/src/view/authorize-html.ts';
import { brandOutcome } from './brand.ts';

export const THEMES = ['light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

const REPOSITORY = path.resolve(import.meta.dirname, '../../../..');
const STYLESHEET_SOURCES = [
  'apps/admin-console/src/shared/view/tokens.css',
  'apps/admin-console/src/shared/view/fonts.css',
  'packages/instrument/src/pages.css',
];

const SIGN_IN_PATH = '/tenants/acme/protocol/openid-connect/auth?client_id=notes';
const RULES = {
  minLength: 15,
  requireDigit: false,
  requireUppercase: false,
  requireLowercase: false,
  requireSpecial: false,
};

interface Shot {
  name: string;
  render: (locale: PageLocale) => RenderedPage;
}

// Pictures in a group are cut to one canvas, so a row of frames has one height
// whatever the page's own; a "natural" picture is the page and its margin only.
export type Group = 'large' | 'small' | 'natural';

export interface Job extends Shot {
  file: string;
  brand: boolean;
  group: Group;
}

function login(form: string, locale: PageLocale, remember = true): RenderedPage {
  return renderLoginForm(
    'acme',
    'a-session',
    form,
    form === 'password',
    remember,
    undefined,
    false,
    'Notes',
    { createAccount: '/create', resetPassword: '/reset' },
    locale,
  );
}

const SHOTS: Shot[] = [
  { name: 'sign-in', render: (locale) => login('password', locale) },
  {
    name: 'create-account',
    render: (locale) =>
      renderRegistrationForm('acme', { rules: RULES, signInPath: SIGN_IN_PATH }, locale),
  },
  {
    name: 'reset-password',
    render: (locale) => renderResetRequestForm('acme', { signInPath: SIGN_IN_PATH }, locale),
  },
  { name: 'second-factor', render: (locale) => login('otp', locale, false) },
];

const GROUPS: Record<string, Group> = {
  'sign-in': 'large',
  'create-account': 'large',
  'reset-password': 'small',
  'second-factor': 'small',
};

export const JOBS: Job[] = [
  ...SHOTS.map((shot) => ({
    ...shot,
    file: shot.name,
    brand: false,
    group: GROUPS[shot.name] ?? 'natural',
  })),
  ...SHOTS.filter((shot) => shot.name === 'sign-in').flatMap((shot) => [
    { ...shot, file: 'look-odudu', brand: false, group: 'natural' as const },
    { ...shot, file: 'look-other', brand: true, group: 'natural' as const },
  ]),
];

export function markupFor(job: Job, theme: Theme): string {
  const plain: PageLocale = { ...DEFAULT_PAGE_LOCALE, theme };
  const locale = job.brand ? withBranding(plain, brandOutcome().branding) : plain;
  return job.render(locale).html;
}

// The stylesheet is built from these three sources, so hashing them stands in
// for the built file, which a fresh checkout does not have.
function stylesheetSources(): string {
  return STYLESHEET_SOURCES.map((file) => readFileSync(path.join(REPOSITORY, file), 'utf8')).join(
    '\n',
  );
}

// A page that carries a script draws a new nonce on every render.
const NONCE = /nonce="[^"]*"/gu;

export function renderedHash(job: Job): string {
  const hash = createHash('sha256');
  for (const theme of THEMES) hash.update(markupFor(job, theme).replace(NONCE, 'nonce=""'));
  hash.update(stylesheetSources());
  return hash.digest('hex').slice(0, 16);
}
