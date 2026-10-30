import type { ThemeView } from '@odudu/contracts/admin';
import { capitalise } from '#/shared/service/format';
import { SLOT_RULES } from '#/features/branding/service/assets';
import type { ThemeScope } from '#/features/branding/service/scope';
import { PAGE_KIND_LABELS, pageKindOf } from '#/features/branding/service/templates';
import type { ImageSlot } from '#/features/branding/service/values';

type Source = 'client' | 'tenant' | 'default';

const WORDS: Readonly<Record<ThemeScope['kind'], Readonly<Record<Source, string>>>> = {
  tenant: { client: 'this client', tenant: 'this tenant', default: 'Instrument’s default' },
  client: { client: 'this client', tenant: 'the tenant', default: 'Instrument’s default' },
};

function wordsFor(scope: ThemeScope, source: Source | undefined): string {
  return WORDS[scope.kind][source ?? 'default'];
}

const NAMED: Readonly<Record<string, string>> = {
  'tokens.light': 'light colours',
  'tokens.dark': 'dark colours',
  'tokens.font': 'font',
  stylesheet: 'stylesheet',
};

function isSlot(name: string): name is ImageSlot {
  return Object.hasOwn(SLOT_RULES, name);
}

// What a piece is called when it is said to be hidden: `assets.logo` is the logo.
function pieceName(piece: string): string {
  const known = NAMED[piece];
  if (known !== undefined) return known;
  const [group = '', name = ''] = piece.split('.');
  if (group === 'assets' && isSlot(name)) return SLOT_RULES[name].label.toLowerCase();
  const kind = group === 'templates' ? pageKindOf(name) : undefined;
  return kind === undefined ? piece : `${PAGE_KIND_LABELS[kind].toLowerCase()} page template`;
}

// What a client's own piece sets aside: the tenant's, where the tenant sets
// one, else Instrument's. Nothing is said before the tenant's theme is known.
function hidden(scope: ThemeScope, view: ThemeView, piece: string): string | null {
  if (scope.kind !== 'client' || scope.below === undefined) return null;
  const live = view.sources[piece] === 'client';
  if (!live && view.draft_sources?.[piece] !== 'client') return null;
  const tenants = scope.below[piece] === 'tenant';
  const name = pieceName(piece);
  const below = tenants ? `the tenant’s ${name}` : `Instrument’s default ${name}`;
  const verb = tenants ? 'hides' : 'replaces';
  return live ? `${capitalise(verb)} ${below}` : `The draft ${verb} ${below} once published`;
}

// Which layer supplies a piece: of the draft once there is one, and of what
// users see now, and at a client what its own piece sets aside. `piece` is the
// server's name for it, such as `assets.logo`.
export function sourceReading(scope: ThemeScope, view: ThemeView, piece: string): string {
  const published = `Published: ${wordsFor(scope, view.sources[piece])}`;
  const layers =
    view.draft_sources === null
      ? published
      : `Draft: ${wordsFor(scope, view.draft_sources[piece])} · ${published}`;
  const sets = hidden(scope, view, piece);
  return sets === null ? layers : `${layers} · ${sets}`;
}
