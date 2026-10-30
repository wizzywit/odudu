import {
  MAIL_PREVIEW_LOCALES,
  type MailBrandingView,
  type MailColoursView,
} from '@odudu/contracts/admin';
import type { Choice } from '#/shared/service/choice';
import type { Scheme } from '#/features/branding/service/palette';
import { previewable } from '#/shared/service/profileUrl';
import { languageChoices } from '#/shared/service/locales';

export const MAIL_PREVIEW_TITLE = 'Preview';

export const MAIL_AS_LABEL = 'Preview as client';

export const MAIL_TENANT_OWN = 'Show the tenant’s own';

// What the preview shows: the tenant's look, or a client's over it.
export function mailPreviewNote(clientName: string | null): string {
  const whose =
    clientName === null
      ? 'the published theme'
      : `the published theme of ${clientName} over the tenant’s`;
  return `The verification mail, drawn by the code that sends it, from ${whose} and the tenant’s message overrides. Changes to the draft appear once you publish.`;
}

export const MAIL_FRAME_TITLE = 'Preview of the verification mail';

export const MAIL_SCHEME_LABEL = 'Colour scheme';

export const MAIL_LOCALE_LABEL = 'Language';

export const MAIL_INHERITS_TITLE = 'What the mail inherits';

// A mail takes the tenant's logo and colours, or a client's over them when its
// flow began inside that client's sign-in; this says which one is shown.
export function mailInheritsLead(clientName: string | null): string {
  const shown =
    clientName === null
      ? 'This shows the tenant’s own; choose a client to see the mail its sign-in sends.'
      : `This shows the mail a sign-in of ${clientName} sends.`;
  return `Mail takes the tenant’s published logo and colours, and its message overrides. A mail whose flow began inside a client’s sign-in takes that client’s logo and colours over these. ${shown} Never a stylesheet or a template. Where the theme sets nothing, the mail keeps Odudu’s own colours and mark.`;
}

export const MAIL_CLIENTS_NOTE =
  'A mail client chooses the light or the dark colours by its own setting, so each is listed here and the preview shows one at a time.';

export const LOGO_TITLE = 'Logo';

export const NO_LOGO = 'None set. The mail shows Odudu’s own mark.';

export const NO_DARK_LOGO = 'None set. The light logo is shown in both schemes.';

export const LOGO_LABEL = 'Logo';

export const DARK_LOGO_LABEL = 'Logo for the dark scheme';

export const LOGO_ELSEWHERE =
  'Not drawn here: this page loads pictures only from its own address. It is shown in the preview above.';

export const MAIL_FAILED = 'The colours and logo could not be loaded.';

export const MAIL_LOADING_BRANDING = 'Loading what the mail inherits';

export interface MailChoice {
  scheme: Scheme;
  // Empty is the tenant's default language.
  locale: string;
  // The id of the client whose mail is shown; empty is the tenant's own.
  client: string;
}

export const DEFAULT_MAIL_CHOICE: MailChoice = { scheme: 'light', locale: '', client: '' };

export function mailChoiceWith(was: MailChoice, change: Partial<MailChoice>): MailChoice {
  return { ...was, ...change };
}

export interface MailClient {
  id: string;
  name: string;
}

// The client a picker's selection names, among the options it holds; the one
// chosen last, since a multiple-choice picker reports every id it holds.
export function mailClientOf(
  options: readonly MailClient[],
  ids: readonly string[],
): MailClient | null {
  const id = ids.at(-1);
  const found = options.find((option) => option.id === id);
  return found === undefined ? null : { id: found.id, name: found.name };
}

// What the choice of client means to the rest of the tab: the id the routes
// are asked with (empty is the tenant's own), the name the wording uses, and
// the ids the picker shows as selected.
export function mailClientId(client: MailClient | null): string {
  return client === null ? '' : client.id;
}

export function mailClientName(client: MailClient | null): string | null {
  return client === null ? null : client.name;
}

export function mailClientSelection(client: MailClient | null): string[] {
  return client === null ? [] : [client.id];
}

export const TENANT_DEFAULT_LANGUAGE = 'The tenant’s default';

export const MAIL_LOCALE_OPTIONS: readonly Choice[] = [
  { id: '', label: TENANT_DEFAULT_LANGUAGE },
  ...languageChoices(MAIL_PREVIEW_LOCALES),
];

export function mailLocaleOf(id: string): string | undefined {
  return MAIL_LOCALE_OPTIONS.find((option) => option.id === id)?.id;
}

// What the preview strip calls the mail it shows.
export const MAIL_SUMMARY_NAME = 'Email';

export function mailLocaleLabel(id: string): string {
  return MAIL_LOCALE_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

// A frame reloads when what it shows may have changed: the published version,
// or what is asked of it.
export function mailFrameKey(publishedVersion: number | undefined, choice: MailChoice): string {
  return `${String(publishedVersion ?? 0)}|${choice.scheme}|${choice.locale}|${choice.client}`;
}

type RoleKey = keyof MailColoursView;

const ROLES: readonly { key: RoleKey; label: string; used: string }[] = [
  { key: 'page', label: 'Page background', used: 'Around the message.' },
  { key: 'panel', label: 'Message background', used: 'The card the text sits on.' },
  { key: 'sunken', label: 'Link box background', used: 'Behind the address to copy.' },
  { key: 'border', label: 'Border', used: 'Around the card and the link box.' },
  { key: 'ink', label: 'Text', used: 'The heading and the message.' },
  { key: 'muted', label: 'Quiet text', used: 'The notes and the footer.' },
  { key: 'link', label: 'Link', used: 'The address, and a link in the text.' },
  { key: 'button', label: 'Button', used: 'The button’s fill.' },
  { key: 'button_ink', label: 'Button text', used: 'The words on the button.' },
];

export interface PaletteRow {
  role: RoleKey;
  label: string;
  used: string;
  colour: string;
}

export function paletteRows(colours: MailColoursView): readonly PaletteRow[] {
  return ROLES.map(({ key, label, used }) => ({ role: key, label, used, colour: colours[key] }));
}

export function sourceText(source: 'client' | 'tenant' | 'default'): string {
  if (source === 'client') return 'From the client’s published theme.';
  return source === 'tenant' ? 'From the tenant’s published theme.' : 'Odudu’s default.';
}

export function schemeTitle(scheme: Scheme): string {
  return scheme === 'light' ? 'Light colours' : 'Dark colours';
}

export interface LogoView {
  label: string;
  empty: string;
  src: string | null;
  // The address this page may draw the picture from, when it is its own.
  picture: string | null;
  alt: string | null;
  size: string | null;
}

export function logoViews(branding: MailBrandingView, origin: string): readonly LogoView[] {
  const view = (label: string, empty: string, logo: MailBrandingView['logo']): LogoView => ({
    label,
    empty,
    src: logo?.src ?? null,
    picture: logo !== null && previewable(logo.src, origin) ? logo.src : null,
    alt: logo?.alt ?? null,
    size: logo === null ? null : `${String(logo.width)} by ${String(logo.height)} pixels`,
  });
  return [
    view(LOGO_LABEL, NO_LOGO, branding.logo),
    view(DARK_LOGO_LABEL, NO_DARK_LOGO, branding.dark_logo),
  ];
}
