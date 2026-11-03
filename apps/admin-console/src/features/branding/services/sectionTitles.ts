import { andList } from '#/shared/services/format';
import { IMAGES_TITLE } from '#/features/branding/services/imageSection';
import { COLOURS_TITLE } from '#/features/branding/services/colourSection';
import { STYLESHEET_SECTION_TITLE } from '#/features/branding/services/stylesheet';
import { TEMPLATES_SECTION_TITLE } from '#/features/branding/services/templateParts';

const SECTION_TITLES: Readonly<Record<string, string>> = {
  colours: COLOURS_TITLE,
  images: IMAGES_TITLE,
  stylesheet: STYLESHEET_SECTION_TITLE,
  templates: TEMPLATES_SECTION_TITLE,
};

// The sentence that holds an action back while sections have unsaved edits.
// `action` is what the person may do first: only save, or save or discard
// (discarding the draft leaves the edits alone, so either clears the hold).
export function unsavedBlock(
  sections: readonly string[],
  reason: string,
  action: 'save' | 'save-or-discard' = 'save',
): string {
  const first = action === 'save' ? 'Save' : 'Save or discard';
  return `${first} your changes first, in ${andList(sections.map((title) => `“${title}”`))}: ${reason}.`;
}

// The titles of the sections holding unsaved edits, in the order they sit.
export function unsavedSections(dirty: ReadonlySet<string>): readonly string[] {
  return Object.entries(SECTION_TITLES)
    .filter(([id]) => dirty.has(id))
    .map(([, title]) => title);
}
