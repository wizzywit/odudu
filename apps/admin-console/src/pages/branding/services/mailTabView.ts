import type { MailBrandingView, MailSchemeName } from '#/pages/branding/types/mailBranding';
import type { Choice } from '#/shared/lib/services/choice';
import {
  mailClientName,
  mailClientSelection,
  type MailChoice,
  type MailClient,
} from '#/pages/branding/services/mailChoice';
import {
  MAIL_INHERITS_TITLE,
  MAIL_CLIENTS_NOTE,
  mailInheritsLead,
  paletteRows,
  sourceText,
  type PaletteRow,
} from '#/pages/branding/services/mailInheritance';
import {
  logoViews,
  LOGO_ELSEWHERE,
  LOGO_TITLE,
  type LogoView,
} from '#/pages/branding/services/mailLogos';
import {
  MAIL_LOCALE_LABEL,
  MAIL_LOCALE_OPTIONS,
  MAIL_SUMMARY_NAME,
  mailLocaleLabel,
  mailLocaleOf,
} from '#/pages/branding/services/mailLocale';
import {
  MAIL_AS_LABEL,
  MAIL_FAILED,
  MAIL_FRAME_TITLE,
  MAIL_LOADING_BRANDING,
  MAIL_PREVIEW_TITLE,
  MAIL_TENANT_OWN,
  mailPreviewNote,
} from '#/pages/branding/services/mailPreview';

// How the colour scheme is named and chosen, which the theme editor owns.
export interface SchemeWords {
  pickerLabel: string;
  options: readonly { id: string; label: string }[];
  label: (scheme: MailSchemeName) => string;
  coloursTitle: (scheme: MailSchemeName) => string;
  summary: (...parts: readonly string[]) => string;
}

export interface ClientChoiceView {
  label: string;
  selected: string[];
  // The button back to the tenant's own look, while a client is chosen.
  tenantOwn: string | null;
}

export function mailClientChoice(client: MailClient | null): ClientChoiceView {
  return {
    label: MAIL_AS_LABEL,
    selected: mailClientSelection(client),
    tenantOwn: client === null ? null : MAIL_TENANT_OWN,
  };
}

export interface MailPreviewView {
  title: string;
  summary: string;
  lead: string;
  frameTitle: string;
  scheme: { label: string; options: readonly { id: string; label: string }[]; value: string };
  locale: { label: string; options: readonly Choice[]; value: string };
}

// What the preview strip, its choices and its frame say of the mail shown.
export function mailPreviewView(
  choice: MailChoice,
  client: MailClient | null,
  schemes: SchemeWords,
): MailPreviewView {
  return {
    title: MAIL_PREVIEW_TITLE,
    summary: schemes.summary(
      MAIL_SUMMARY_NAME,
      schemes.label(choice.scheme),
      mailLocaleLabel(choice.locale),
      mailClientName(client) ?? '',
    ),
    lead: mailPreviewNote(mailClientName(client)),
    frameTitle: MAIL_FRAME_TITLE,
    scheme: { label: schemes.pickerLabel, options: schemes.options, value: choice.scheme },
    locale: { label: MAIL_LOCALE_LABEL, options: MAIL_LOCALE_OPTIONS, value: choice.locale },
  };
}

// Hands on the preview language a control's id names, nothing for any other.
export function chooseLocale(id: string, choose: (locale: string) => void): void {
  const locale = mailLocaleOf(id);
  if (locale !== undefined) choose(locale);
}

export const MAIL_BRANDING_WORDS = { loading: MAIL_LOADING_BRANDING, failed: MAIL_FAILED } as const;

export interface PaletteView {
  scheme: MailSchemeName;
  legend: string;
  source: string;
  columns: { colour: string; value: string; used: string };
  rows: readonly PaletteRow[];
}

export interface InheritsView {
  title: string;
  lead: string;
  note: string;
  logos: { title: string; elsewhere: string; items: readonly LogoView[] };
  palettes: PaletteView[];
}

const SCHEME_ORDER: readonly MailSchemeName[] = ['light', 'dark'];

// What the mail takes of the theme: the logos and each scheme's colours.
export function inheritsView(
  branding: MailBrandingView,
  input: { origin: string; client: MailClient | null; schemes: SchemeWords },
): InheritsView {
  return {
    title: MAIL_INHERITS_TITLE,
    lead: mailInheritsLead(mailClientName(input.client)),
    note: MAIL_CLIENTS_NOTE,
    logos: {
      title: LOGO_TITLE,
      elsewhere: LOGO_ELSEWHERE,
      items: logoViews(branding, input.origin),
    },
    palettes: SCHEME_ORDER.map((scheme) => ({
      scheme,
      legend: input.schemes.coloursTitle(scheme),
      source: sourceText(branding[scheme].source),
      columns: { colour: 'Colour', value: 'Value', used: 'Used for' },
      rows: paletteRows(branding[scheme].colours),
    })),
  };
}
