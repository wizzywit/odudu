import type { Scheme } from '#/features/branding/service/palette';
import type { PageKind } from '#/features/branding/service/values';
export interface PreviewChoice {
  kind: PageKind;
  scheme: Scheme;
}

export const DEFAULT_PREVIEW: PreviewChoice = { kind: 'sign-in', scheme: 'light' };

export const PREVIEW_TITLE = 'Preview';

export const PREVIEW_KIND_LABEL = 'Page';

export const PREVIEW_SCHEME_LABEL = 'Colour scheme';

export const SCHEME_OPTIONS: readonly { id: Scheme; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export const PREVIEW_NOTE =
  'The saved draft, drawn by the real page. Unsaved changes appear after you save them.';

export const PREVIEW_FRAME_TITLE = 'Preview of the page';

export const PREVIEW_LOADING = 'Loading the preview';

// On a narrow screen the preview is a strip beside the editor; this opens it
// to a page of its own.
export const PREVIEW_OPEN_LABEL = 'Open preview';

export const PREVIEW_SHEET_TITLE = 'Page preview';

export const PREVIEW_CLOSE_LABEL = 'Close preview';

// The strip's line of what it shows: the page, its scheme, and what else the
// preview was asked for.
export function previewSummary(...parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join(' · ');
}

// Whether the preview's account is wanted: a preview is framed and there is a
// theme to frame it over.
export function previewAsked(framed: boolean, view: unknown): boolean {
  return framed && view !== undefined;
}
