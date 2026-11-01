import {
  mailColoursProblem,
  mailLogoProblem,
  type MailBranding,
  type MailColours,
  type MailLogo,
} from '@odudu/kernel';
import { type Palette, type ThemeBody } from '#/service/body';
import { contrastFailures } from '#/service/contrast';

// The box a logo is drawn in beside the tenant's name; the image keeps its
// proportions inside it and is never drawn larger than it is.
export const MAIL_LOGO_BOX = { width: 160, height: 48 } as const;

export interface LogoSize {
  width: number;
  height: number;
}

// Each role is a colour the validator already holds to a contrast ratio
// against every surface the mail puts it on: ink and muted on page, panel
// and sunken; the link ink on all three; the button's ink on its fill.
function coloursOf(palette: Palette): MailColours {
  return {
    page: palette.surfacePage,
    panel: palette.surfacePanel,
    sunken: palette.surfaceSunken,
    border: palette.borderStrong,
    ink: palette.inkPrimary,
    muted: palette.inkMuted,
    link: palette.signalActiveInk,
    button: palette.signalActive,
    buttonInk: palette.signalActiveInk,
  };
}

// A published palette passed contrast when it was saved; it is checked again
// because what is stored is not trusted, and a scheme that fails is left to
// the mail's own colours rather than drawn unreadably.
function scheme(
  name: 'light' | 'dark',
  palette: Palette | undefined,
  problems: string[],
): MailColours | null {
  if (palette === undefined) return null;
  const failures = contrastFailures({ [name]: palette });
  if (failures.length > 0) {
    problems.push(`the ${name} palette fails contrast, so mail keeps its own ${name} colours`);
    return null;
  }
  const colours = coloursOf(palette);
  return mailColoursProblem(colours) === null ? colours : null;
}

export function fitLogo(size: LogoSize): LogoSize {
  const scale = Math.min(1, MAIL_LOGO_BOX.width / size.width, MAIL_LOGO_BOX.height / size.height);
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

export interface MailLogoSource {
  assetId: string;
  alt: string;
}

function logoOf(
  source: MailLogoSource | undefined,
  origin: string,
  urls: Map<string, string>,
  sizes: Map<string, LogoSize>,
): MailLogo | null {
  if (source === undefined) return null;
  const path = urls.get(source.assetId);
  const size = sizes.get(source.assetId);
  if (path === undefined || size === undefined) return null;
  const logo: MailLogo = { src: `${origin}${path}`, alt: source.alt, ...fitLogo(size) };
  return mailLogoProblem(logo) === null ? logo : null;
}

export interface MailBuildInput {
  body: ThemeBody;
  origin: string;
  // Asset id to its served path, and to its pixel size.
  urls: Map<string, string>;
  sizes: Map<string, LogoSize>;
  problems: string[];
}

// What a mail takes from a resolved theme, or null when the theme gives it
// nothing: the mail then looks as it did before the tenant themed anything.
// A dark logo with no light one is not used, since a client that cannot
// swap would have nothing to show.
export function buildMailBranding(input: MailBuildInput): MailBranding | null {
  const { body, origin, urls, sizes, problems } = input;
  const logo = logoOf(body.assets.logo, origin, urls, sizes);
  const mail: MailBranding = {
    palette: scheme('light', body.tokens.light, problems),
    darkPalette: scheme('dark', body.tokens.dark, problems),
    logo,
    darkLogo: logo === null ? null : logoOf(body.assets.darkLogo, origin, urls, sizes),
  };
  const empty = mail.palette === null && mail.darkPalette === null && mail.logo === null;
  return empty ? null : mail;
}
