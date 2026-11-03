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

// The titles of the sections holding unsaved edits, in the order they sit.
export function unsavedSections(dirty: ReadonlySet<string>): readonly string[] {
  return Object.entries(SECTION_TITLES)
    .filter(([id]) => dirty.has(id))
    .map(([, title]) => title);
}
