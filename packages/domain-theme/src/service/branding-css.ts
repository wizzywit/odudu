import { type FontChoice, type Palette, type ThemeBody } from '#/service/body';

const PROPERTY: Record<keyof Palette, string> = {
  surfacePage: '--surface-page',
  surfacePanel: '--surface-panel',
  surfaceSunken: '--surface-sunken',
  inkPrimary: '--ink-primary',
  inkMuted: '--ink-muted',
  signalActive: '--signal-active',
  signalActiveInk: '--signal-active-ink',
  signalDanger: '--signal-danger',
  signalDangerInk: '--signal-danger-ink',
  borderStrong: '--border-strong',
  focusRing: '--focus-ring',
};

const FONT_STACK: Record<FontChoice, string> = {
  'IBM Plex Sans': "'IBM Plex Sans', system-ui, sans-serif",
  'IBM Plex Mono': "'IBM Plex Mono', ui-monospace, monospace",
};

function declarations(palette: Palette): string {
  return (Object.keys(PROPERTY) as (keyof Palette)[])
    .map((key) => `${PROPERTY[key]}:${palette[key]};`)
    .join('');
}

// Each scheme's palette applies when the page is in that scheme: by the
// person's choice (`data-theme`) or, with none, the operating system's.
// Values are hex colours the body schema already restricts, so nothing here
// is written from free text.
function scheme(name: 'light' | 'dark', palette: Palette): string {
  const rules = declarations(palette);
  return (
    `@media (prefers-color-scheme:${name}){:root:not([data-theme]){${rules}}}\n` +
    `:root[data-theme='${name}']{${rules}}\n`
  );
}

// The custom properties a resolved theme sets: its palettes and font.
export function tokensCss(tokens: ThemeBody['tokens']): string {
  return [
    tokens.font === undefined ? '' : `:root{--font-sans:${FONT_STACK[tokens.font]};}\n`,
    tokens.light === undefined ? '' : scheme('light', tokens.light),
    tokens.dark === undefined ? '' : scheme('dark', tokens.dark),
  ].join('');
}

// A path written into a quoted `url()`: the characters that could end the
// string or the function are percent-encoded, which names the same resource.
function cssUrl(path: string): string {
  const safe = path.replace(
    /['"()\\\s]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`,
  );
  return `url('${safe}')`;
}

// The page's backdrop in place of Instrument's grid; the panel the form sits
// on keeps its own surface, so the text stays legible over any image.
export function backgroundCss(path: string | null): string {
  return path === null
    ? ''
    : `body{background-image:${cssUrl(path)};background-size:cover;` +
        'background-position:center;background-repeat:no-repeat;}\n';
}

// What the hashed stylesheet file holds: the tokens, the background, then the
// theme's own sanitised rules, so those win.
export function brandingCss(
  tokens: string,
  stylesheet: string | null,
  backgroundPath: string | null = null,
): string {
  const head = `${tokens}${backgroundCss(backgroundPath)}`;
  return stylesheet === null ? head : `${head}${stylesheet}\n`;
}
