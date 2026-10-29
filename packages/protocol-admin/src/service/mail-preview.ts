import { type MailBrandingView } from '@odudu/contracts/admin';
import { mailSchemeColours, type SchemeColours } from '@odudu/email';
import { type MailBranding, type MailColours, type MailLogo } from '@odudu/kernel';

function coloursView(colours: MailColours): MailBrandingView['light']['colours'] {
  const { buttonInk, ...rest } = colours;
  return { ...rest, button_ink: buttonInk };
}

function schemeView(scheme: SchemeColours, fromClient: boolean): MailBrandingView['light'] {
  const source = scheme.source === 'tenant' && fromClient ? 'client' : scheme.source;
  return { source, colours: coloursView(scheme.colours) };
}

function sameColours(
  a: MailColours | null | undefined,
  b: MailColours | null | undefined,
): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

// A logo with the address it is fetched from, or null where the mail has none.
function logoView(logo: MailLogo | null | undefined): MailBrandingView['logo'] {
  return logo === null || logo === undefined
    ? null
    : { src: logo.src, alt: logo.alt, width: logo.width, height: logo.height };
}

// With `tenant`, the tenant's own look, a palette that differs from it is the
// client's: the client's published theme set it.
export function mailBrandingView(
  branding: MailBranding | null,
  tenant?: MailBranding | null,
): MailBrandingView {
  const fromClient = (light: boolean): boolean =>
    tenant !== undefined &&
    !sameColours(
      light ? branding?.palette : branding?.darkPalette,
      light ? tenant?.palette : tenant?.darkPalette,
    );
  return {
    light: schemeView(mailSchemeColours(branding, 'light'), fromClient(true)),
    dark: schemeView(mailSchemeColours(branding, 'dark'), fromClient(false)),
    logo: logoView(branding?.logo),
    dark_logo: logoView(branding?.darkLogo),
  };
}

// The origins a theme's logos are fetched from, for the policy's `img-src`.
// Each address was checked as a plain web address when the mail was built.
export function logoOrigins(branding: MailBranding | null): string[] {
  const origins = new Set<string>();
  for (const logo of [branding?.logo, branding?.darkLogo]) {
    if (logo === null || logo === undefined) continue;
    try {
      origins.add(new URL(logo.src).origin);
    } catch {
      continue;
    }
  }
  return [...origins];
}
