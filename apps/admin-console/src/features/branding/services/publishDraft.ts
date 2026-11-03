import type { ThemeView } from '@odudu/contracts/admin';
import { unsavedBlock } from '#/features/branding/services/unsavedBlock';

export const PUBLISH_TITLE = 'Publish';

// What the button says where the bar has no room for the longer label.
export const PUBLISH_SHORT = 'Publish';

export const PUBLISH_BODY =
  'Publishing makes the saved draft what people see on the sign-in and account pages, and keeps the version it replaces. Nothing is published until you do.';

export const NOTHING_TO_PUBLISH = 'Nothing to publish: the draft matches what people see.';

export const NO_DRAFT_HOLD = 'There is no draft to publish. Save a change first.';

export function unsavedHold(sections: readonly string[]): string {
  return unsavedBlock(sections, 'publishing uses the saved draft');
}

export function publishHold({
  view,
  unsaved,
  contrast,
}: {
  view: ThemeView;
  unsaved: readonly string[];
  contrast: string | undefined;
}): string | undefined {
  if (unsaved.length > 0) return unsavedHold(unsaved);
  if (view.draft === null) return NO_DRAFT_HOLD;
  if (view.changed.length === 0) return NOTHING_TO_PUBLISH;
  return contrast;
}

export function publishedText(view: ThemeView): string {
  if (view.published === null) return 'Nothing published yet: people see Instrument’s own pages.';
  return `Version ${String(view.published.version)} is published.`;
}

// The short word beside the sentence, since a tag does not wrap.
export function publishedTag(view: ThemeView): { text: string; tone: 'active' | 'neutral' } {
  return view.published === null
    ? { text: 'Not published', tone: 'neutral' }
    : { text: 'Published', tone: 'active' };
}

export const PUBLISHED_TOAST = 'Theme published';

export const PUBLISH_LABEL = 'Publish the draft';

export const PUBLISHING = 'Publishing…';
