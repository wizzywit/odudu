import type { ThemeView } from '#/features/branding-editor/types/theme';
import { counted } from '#/shared/services/format';
import { STYLESHEET_SECTION_TITLE } from '#/features/branding-editor/services/stylesheet';
import { TEMPLATES_SECTION_TITLE } from '#/features/branding-editor/services/templateParts';
import {
  OFFERED_TABS,
  type BrandingTab,
  type OfferedTab,
} from '#/features/branding-editor/services/tabs';
import { IMAGES_TITLE } from '#/features/branding-editor/services/imageSection';
import { COLOURS_TITLE } from '#/features/branding-editor/services/colourSection';

export type ChangedPiece = ThemeView['changed'][number];

// The pieces the server compares, in the order their sections sit on the tabs.
export const PIECE_TITLES: Readonly<Record<ChangedPiece, string>> = {
  tokens: COLOURS_TITLE,
  assets: IMAGES_TITLE,
  stylesheet: STYLESHEET_SECTION_TITLE,
  templates: TEMPLATES_SECTION_TITLE,
};

const PIECE_ORDER = Object.keys(PIECE_TITLES) as readonly ChangedPiece[];

// What each tab edits, which is what its revert takes back.
export const TAB_PIECES: Readonly<Record<BrandingTab, readonly ChangedPiece[]>> = {
  theme: ['tokens', 'assets', 'stylesheet'],
  pages: ['templates'],
  mail: [],
  languages: [],
};

export function changedText(view: ThemeView): string | null {
  const titles = PIECE_ORDER.filter((piece) => view.changed.includes(piece)).map(
    (piece) => PIECE_TITLES[piece],
  );
  return titles.length === 0 ? null : `Changed: ${titles.join(', ')}`;
}

// The line under the bar's status: what is waiting, or that nothing is.
export function barText(view: ThemeView): string {
  if (view.draft === null) return 'No draft.';
  return changedText(view) ?? 'The draft matches what people see.';
}

// What is waiting as a count, for a bar with room for one line only; the
// sentence is what a title carries. Null when nothing is, and the sentence
// ("No draft.") is short enough as it is.
export function changeCount(view: ThemeView): string | null {
  return view.draft === null || view.changed.length === 0
    ? null
    : counted(view.changed.length, 'change', 'changes');
}

// The line a bar with room for a few words says: how many changes wait, or
// that there is no draft or nothing to publish.
export function changeBrief(view: ThemeView): string {
  if (view.draft === null) return 'No draft';
  return changeCount(view) ?? 'Up to date';
}

// The tag's word where the bar has no room for the sentence.
export function publishedShort(view: ThemeView): string {
  return view.published === null ? 'Not live' : 'Live';
}

// The tabs holding part of what would change at a publish.
export function tabsChanged(changed: ThemeView['changed']): ReadonlySet<OfferedTab> {
  return new Set(
    OFFERED_TABS.filter((tab) => TAB_PIECES[tab].some((piece) => changed.includes(piece))),
  );
}

// On a narrow screen the bar keeps Publish and folds what else it does into
// a menu of this name.
export const MORE_TRIGGER = 'More';

export const MORE_LABEL = 'More publishing actions';
